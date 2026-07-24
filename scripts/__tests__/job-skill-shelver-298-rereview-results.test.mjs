import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const paths = {
  script: resolve(root, 'scripts/build-job-skill-shelver-298-rereview-results.mjs'),
  candidates: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json'),
  contentMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.md'),
  safetyMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.md'),
  contentJson: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  safetyJson: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.json'),
  mergedJson: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-rereview-merged-gate-2026-07-20.json'),
  ledger: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-rereview-ledger-2026-07-20.md')
}

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function runBuild() {
  const result = spawnSync(process.execPath, [paths.script], { cwd: root })
  if (result.status !== 0) {
    throw result.error ?? new Error(result.stderr?.toString() || `build exited ${result.status}`)
  }
  return result.stdout.toString()
}

describe('job skill shelver 298 semantic-change re-review results', () => {
  it('parses reviewer Markdown into deterministic JSON and ledger files', () => {
    runBuild()
    const before = {
      content: sha256(readFileSync(paths.contentJson)),
      safety: sha256(readFileSync(paths.safetyJson)),
      merged: sha256(readFileSync(paths.mergedJson)),
      ledger: sha256(readFileSync(paths.ledger))
    }

    const stdout = runBuild()

    expect(stdout).toContain('content=22/210')
    expect(stdout).toContain('safety=22/210')
    expect(sha256(readFileSync(paths.contentJson))).toBe(before.content)
    expect(sha256(readFileSync(paths.safetyJson))).toBe(before.safety)
    expect(sha256(readFileSync(paths.mergedJson))).toBe(before.merged)
    expect(sha256(readFileSync(paths.ledger))).toBe(before.ledger)
  })

  it('keeps both reviewer originals and binds result files to their hashes', () => {
    runBuild()
    const content = readJson(paths.contentJson)
    const safety = readJson(paths.safetyJson)

    expect(content.reviewer).toMatchObject({ name: '陈晓青', reviewed_date: '2026-07-20' })
    expect(safety.reviewer).toMatchObject({ name: '赫东', reviewed_date: '2026-07-20' })
    expect(content.source_files[0]).toEqual({
      path: 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.md',
      sha256: sha256(readFileSync(paths.contentMarkdown)),
      role: 'reviewer_submitted_markdown'
    })
    expect(safety.source_files[0]).toEqual({
      path: 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.md',
      sha256: sha256(readFileSync(paths.safetyMarkdown)),
      role: 'reviewer_submitted_markdown'
    })
  })

  it('matches the 232 semantic-change candidates by id, type, source hash and candidate hash', () => {
    runBuild()
    const candidates = readJson(paths.candidates)
    const expected = candidates.questions.filter((question) => question.revision_application.semantic_change_re_review_required)
    const content = readJson(paths.contentJson)
    const safety = readJson(paths.safetyJson)

    expect(expected).toHaveLength(232)
    expect(content.questions).toHaveLength(232)
    expect(safety.questions).toHaveLength(232)
    expect(content.questions.map((question) => question.question_id)).toEqual(expected.map((question) => question.question_id))
    expect(safety.questions.map((question) => question.question_id)).toEqual(expected.map((question) => question.question_id))
    expect(content.questions.map((question) => question.candidate_record_hash)).toEqual(expected.map((question) => question.candidate_record_hash))
    expect(safety.questions.map((question) => question.candidate_record_hash)).toEqual(expected.map((question) => question.candidate_record_hash))
  })

  it('records pass and return counts without granting activation authority', () => {
    runBuild()
    const content = readJson(paths.contentJson)
    const safety = readJson(paths.safetyJson)
    const merged = readJson(paths.mergedJson)

    expect(content.summary).toMatchObject({ total: 232, pass: 22, return_for_revision: 210 })
    expect(safety.summary).toMatchObject({ total: 232, pass: 22, return_for_revision: 210 })
    expect(merged.summary.total).toBe(232)
    expect(merged.summary.passed + merged.summary.return_for_revision).toBe(232)
    expect(merged.activation_authority.may_activate).toBe(false)
    expect(new Set(merged.questions.map((question) => question.candidate_runtime_status))).toEqual(new Set(['DRAFT']))
  })
})
