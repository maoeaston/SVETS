import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const archiveRoot = resolve(root, 'doc/features/archive/job-skill-shelver-pilot-r0-v1-v2')
const candidates = JSON.parse(readFileSync(resolve(archiveRoot, 'job-skill-shelver-pilot-revision-candidates-v2.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(archiveRoot, 'job-skill-shelver-pilot-activation-manifest-v2.json'), 'utf8'))
const contentResult = JSON.parse(readFileSync(resolve(archiveRoot, 'job-skill-shelver-pilot-content-review-result-2026-07-19.json'), 'utf8'))
const packetHtml = readFileSync(resolve(archiveRoot, 'job-skill-shelver-pilot-safety-technical-review-packet-v2.html'), 'utf8')

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function embeddedPackage() {
  const match = packetHtml.match(/<script id="package-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('package-data missing')
  return JSON.parse(match[1])
}

describe('job skill shelver review pack v2', () => {
  it('creates a 24-question strategy v2 candidate set without overwriting returned v1 IDs', () => {
    const returnedIds = contentResult.questions
      .filter((question) => question.content_conclusion === 'RETURN_FOR_REVISION')
      .map((question) => question.question_id)
      .sort()
    const revisedPreviousIds = candidates.questions
      .filter((question) => question.question_version === 2)
      .map((question) => question.previous_question_id)
      .sort()

    expect(candidates.questions).toHaveLength(24)
    expect(new Set(candidates.questions.map((question) => question.question_id)).size).toBe(24)
    expect(revisedPreviousIds).toEqual(returnedIds)
    expect(candidates.summary.reused_content_approved_v1).toBe(11)
    expect(candidates.summary.revised_v2_awaiting_content_reconfirmation).toBe(13)
    expect(candidates.questions.filter((question) => question.question_version === 2).every((question) => question.question_id.endsWith('_V2'))).toBe(true)
  })

  it('binds manifest v2 to the exact candidate set and remains fail closed', () => {
    expect(manifest.strategy_binding.strategy_version).toBe(2)
    expect(manifest.activation_authorized).toBe(false)
    expect(manifest.gate.status).toBe('PENDING')
    expect(candidates.strategy_candidate.runtime_seed_status).toBe('NOT_INSERTED')
    expect(manifest.questions.map((question) => question.question_id)).toEqual(candidates.questions.map((question) => question.question_id))
    expect(manifest.questions.map((question) => question.candidate_record_hash)).toEqual(candidates.questions.map((question) => question.candidate_record_hash))
  })

  it('recomputes every candidate record hash and strategy contract hash', () => {
    for (const question of candidates.questions) {
      const { candidate_record_hash: actual, ...record } = question
      expect(actual).toBe(hash(record))
    }
    expect(candidates.strategy_contract_hash).toBe(hash(candidates.strategy_candidate))
  })

  it('embeds the same candidates in the self-contained safety and technical packet', () => {
    const packet = embeddedPackage()
    expect(packet.manifest_id).toBe(manifest.manifest_id)
    expect(packet.strategy_version).toBe(2)
    expect(packet.reviewer_name).toBe('赫东')
    expect(packet.questions).toEqual(candidates.questions)
    expect(packetHtml).not.toMatch(/<script[^>]+src=/)
    expect(packetHtml).not.toMatch(/<link[^>]+href=/)

    const scripts = [...packetHtml.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(2)
    expect(() => new vm.Script(scripts[1][1], { filename: 'review-packet-inline.js' })).not.toThrow()
  })
})
