import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const candidatesPath = resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json')
const contentMarkdownPath = resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1.md')
const safetyMarkdownPath = resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1.md')
const contentHtmlPath = resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1.html')
const safetyHtmlPath = resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1.html')
const contentSchemaPath = resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-v1.schema.json')
const safetySchemaPath = resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-v1.schema.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

function embeddedPackage(path) {
  const html = readFileSync(path, 'utf8')
  const match = html.match(/<script id="package-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error(`${path} package-data missing`)
  return JSON.parse(match[1])
}

function inlineScriptsCompile(path) {
  const html = readFileSync(path, 'utf8')
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
  expect(scripts).toHaveLength(2)
  expect(() => new vm.Script(scripts[1][1], { filename: `${path}-inline.js` })).not.toThrow()
}

describe('job skill shelver 298 semantic change re-review packets', () => {
  it('builds deterministic Markdown and optional HTML packets for both reviewers', () => {
    const before = {
      candidates: sha256(readFileSync(candidatesPath)),
      contentMd: sha256(readFileSync(contentMarkdownPath)),
      safetyMd: sha256(readFileSync(safetyMarkdownPath)),
      contentHtml: sha256(readFileSync(contentHtmlPath)),
      safetyHtml: sha256(readFileSync(safetyHtmlPath)),
      contentSchema: sha256(readFileSync(contentSchemaPath)),
      safetySchema: sha256(readFileSync(safetySchemaPath))
    }
    const rebuild = spawnSync(process.execPath, [resolve(root, 'scripts/build-job-skill-shelver-298-rereview-packets.mjs')], { cwd: root })
    if (rebuild.status !== 0) {
      throw rebuild.error ?? new Error(rebuild.stderr?.toString() || `rebuild exited ${rebuild.status}`)
    }
    expect(sha256(readFileSync(candidatesPath))).toBe(before.candidates)
    expect(sha256(readFileSync(contentMarkdownPath))).toBe(before.contentMd)
    expect(sha256(readFileSync(safetyMarkdownPath))).toBe(before.safetyMd)
    expect(sha256(readFileSync(contentHtmlPath))).toBe(before.contentHtml)
    expect(sha256(readFileSync(safetyHtmlPath))).toBe(before.safetyHtml)
    expect(sha256(readFileSync(contentSchemaPath))).toBe(before.contentSchema)
    expect(sha256(readFileSync(safetySchemaPath))).toBe(before.safetySchema)
  })

  it('includes exactly the 232 semantic-change V2 candidates and binds every new hash', () => {
    const candidates = readJson(candidatesPath)
    const expected = candidates.questions.filter((question) => question.revision_application.semantic_change_re_review_required)
    const contentPacket = embeddedPackage(contentHtmlPath)
    const safetyPacket = embeddedPackage(safetyHtmlPath)

    expect(expected).toHaveLength(232)
    expect(contentPacket.questions).toHaveLength(232)
    expect(safetyPacket.questions).toHaveLength(232)
    expect(contentPacket.questions.map((question) => question.question_id)).toEqual(expected.map((question) => question.question_id))
    expect(safetyPacket.questions.map((question) => question.question_id)).toEqual(expected.map((question) => question.question_id))
    expect(contentPacket.questions.map((question) => question.candidate_record_hash)).toEqual(expected.map((question) => question.candidate_record_hash))
    expect(safetyPacket.questions.map((question) => question.candidate_record_hash)).toEqual(expected.map((question) => question.candidate_record_hash))
    expect(contentPacket.source.summary_by_type).toEqual({ SINGLE_CHOICE: 56, TRUE_FALSE: 68, DRAG: 25, OFFLINE_OPERATION: 83 })
    expect(safetyPacket.source.summary_by_type).toEqual(contentPacket.source.summary_by_type)
  })

  it('renders reviewer-specific Markdown filling areas and result schemas', () => {
    const contentMarkdown = readFileSync(contentMarkdownPath, 'utf8')
    const safetyMarkdown = readFileSync(safetyMarkdownPath, 'utf8')
    const contentSchema = readJson(contentSchemaPath)
    const safetySchema = readJson(safetySchemaPath)

    expect(contentMarkdown).toContain('# 232道语义变化候选内容复审包（陈晓青）')
    expect(contentMarkdown).toContain('- 审核人：陈晓青')
    expect(contentMarkdown).toContain('- 内容复审结论：[ ] 通过 / [ ] 退回复修')
    expect(contentMarkdown.match(/^## \d+\. M[1-6]_[A-Z]+_\d+_V2 \|/gm)).toHaveLength(232)
    expect(safetyMarkdown).toContain('# 232道语义变化候选安全与技术复审包（赫东）')
    expect(safetyMarkdown).toContain('- 审核人：赫东')
    expect(safetyMarkdown).toContain('- 安全结论：[ ] 通过 / [ ] 退回复修')
    expect(safetyMarkdown).toContain('- 技术结论：[ ] 通过 / [ ] 退回复修')
    expect(safetyMarkdown.match(/^## \d+\. M[1-6]_[A-Z]+_\d+_V2 \|/gm)).toHaveLength(232)

    expect(contentSchema.properties.reviewer.properties.name.const).toBe('陈晓青')
    expect(safetySchema.properties.reviewer.properties.name.const).toBe('赫东')
    expect(contentSchema.properties.questions.minItems).toBe(232)
    expect(safetySchema.properties.questions.maxItems).toBe(232)
  })

  it('keeps optional HTML packets self-contained and script-parseable', () => {
    for (const path of [contentHtmlPath, safetyHtmlPath]) {
      const html = readFileSync(path, 'utf8')
      expect(html).not.toMatch(/<script[^>]+src=/)
      expect(html).not.toMatch(/<link[^>]+href=/)
      inlineScriptsCompile(path)
    }
  })
})
