import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  content: feature('job-skill-shelver-298-targeted-v3-content-rereview-result-chen-xiaoqing-v2.json'),
  safety: feature('job-skill-shelver-298-targeted-v3-safety-technical-rereview-result-he-dong-type-scoped-v2.json'),
  candidates: feature('job-skill-shelver-298-question-revision-candidates-v3.json'),
  merged: feature('job-skill-shelver-298-targeted-v3-rereview-merged-gate-v1.json'),
  ledger: feature('job-skill-shelver-298-targeted-v3-rereview-ledger-v1.md'),
  delivery: feature('job-skill-shelver-question-delivery-lock-v1.json'),
  sql: feature('question-bank-import.sql')
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('job skill shelver targeted V3 review result intake', () => {
  it('preserves the two reviewer exports byte-for-byte', () => {
    expect(sha256(paths.content)).toBe('9f0d6d1a2693c31a699817afc46a4098db51015bb42b8842d85417653346a850')
    expect(sha256(paths.safety)).toBe('84ad8a0fb79e6b634b0a3549136208bc21bf8fdae4acadbf70686b89efdfa986')
  })

  it('reconciles every required review without gaps, duplicates, or hash drift', () => {
    const candidates = readJson(paths.candidates)
    const content = readJson(paths.content)
    const safety = readJson(paths.safety)
    const expectedContent = candidates.questions.filter((question) => question.required_review_tracks.includes('CONTENT'))
    const expectedSafety = candidates.questions.filter((question) => question.required_review_tracks.includes('SAFETY_TECHNICAL'))
    expect(content.results).toHaveLength(expectedContent.length)
    expect(safety.questions).toHaveLength(expectedSafety.length)
    expect(new Set(content.results.map((question) => question.question_id)).size).toBe(144)
    expect(new Set(safety.questions.map((question) => question.question_id)).size).toBe(135)
    expect(content.candidate_set_hash).toBe(candidates.candidate_set_hash)
    expect(safety.candidate_set_hash).toBe(candidates.candidate_set_hash)
  })

  it('merges decisions, fails closed on answer conflicts, and scopes V4 review tracks', () => {
    const merged = readJson(paths.merged)
    expect(merged).toMatchObject({
      status: 'COMPLETED_WITH_RETURNS_AND_CONTRACT_CONFLICTS',
      summary: {
        total: 145, passed: 4, return_for_revision: 137, blocked_contract_conflict: 4, pending: 0,
        returns_by_question_type: { DRAG: 16, OFFLINE_OPERATION: 83, SINGLE_CHOICE: 30, TRUE_FALSE: 8 },
        returns_by_failed_tracks: { CONTENT: 21, 'CONTENT+SAFETY_TECHNICAL': 115, SAFETY_TECHNICAL: 1 },
        v4_by_next_review_tracks: { CONTENT: 21, 'CONTENT+SAFETY_TECHNICAL': 119, SAFETY_TECHNICAL: 1 }
      },
      authority: { releaseable: false, phase_4_allowed: false, v4_required: 141 }
    })
    expect(merged.questions.filter((question) => question.status === 'PASSED').map((question) => question.question_id)).toEqual([
      'M6_SC_001_V3', 'M6_SC_002_V3', 'M6_SC_004_V3', 'M6_SC_010_V3'
    ])
    expect(merged.questions.filter((question) => question.status === 'BLOCKED_CONTRACT_CONFLICT').map((question) => question.question_id)).toEqual([
      'M3_TF_030_V3', 'M3_TF_033_V3', 'M3_TF_034_V3', 'M4_TF_022_V3'
    ])
    for (const question of merged.questions.filter((item) => item.status !== 'PASSED')) {
      expect(question.next_question_id).toMatch(/_V4$/)
      expect(question.next_review_tracks).not.toHaveLength(0)
    }
  })

  it('rebuilds deterministically without touching delivery or runtime SQL', () => {
    const watched = [paths.content, paths.safety, paths.merged, paths.ledger, paths.delivery, paths.sql]
    const before = Object.fromEntries(watched.map((path) => [path, sha256(path)]))
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/ingest-job-skill-shelver-298-targeted-v3-results.mjs'), '--check'], { cwd: root })
    if (result.status !== 0) throw result.error ?? new Error(result.stderr.toString())
    for (const path of watched) expect(sha256(path)).toBe(before[path])
  })
})
