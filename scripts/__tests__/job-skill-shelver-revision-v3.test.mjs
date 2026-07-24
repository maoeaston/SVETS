import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const v2 = JSON.parse(readFileSync(resolve(root, 'doc/features/archive/job-skill-shelver-pilot-r0-v1-v2/job-skill-shelver-pilot-revision-candidates-v2.json'), 'utf8'))
const v3 = JSON.parse(readFileSync(resolve(root, 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(root, 'doc/features/job-skill-shelver-pilot-activation-manifest-v3.json'), 'utf8'))

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

function hash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

describe('job skill shelver pilot revision v3', () => {
  it('contains the fixed 18+6 set with seven required new online IDs', () => {
    expect(v3.questions).toHaveLength(24)
    expect(v3.questions.filter((question) => question.question_type === 'SINGLE_CHOICE')).toHaveLength(18)
    expect(v3.questions.filter((question) => question.question_type === 'OFFLINE_OPERATION')).toHaveLength(6)
    expect(v3.questions.filter((question) => question.provenance.revision_spec).map((question) => question.question_id)).toEqual([
      'M2_SC_003_V2', 'M2_SC_005_V3', 'M5_SC_001_V2', 'M5_SC_002_V2', 'M5_SC_009_V2', 'M6_SC_003_V2', 'M6_SC_009_V2'
    ])
  })

  it('recalculates every candidate hash from the canonical record', () => {
    for (const question of v3.questions) {
      const { candidate_record_hash: actual, ...record } = question
      expect(actual).toBe(hash(record))
    }
  })

  it('preserves all six offline IDs, versions and hashes', () => {
    const v2ById = new Map(v2.questions.map((question) => [question.question_id, question]))
    for (const question of v3.questions.filter((candidate) => candidate.question_type === 'OFFLINE_OPERATION')) {
      const previous = v2ById.get(question.question_id)
      expect(previous).toBeDefined()
      expect(question.question_version).toBe(previous.question_version)
      expect(question.candidate_record_hash).toBe(previous.candidate_record_hash)
    }
  })

  it('keeps activation fail closed and binds manifest to v3 candidates', () => {
    expect(manifest.activation_authorized).toBe(false)
    expect(manifest.manifest_status).toBe('PENDING')
    expect(manifest.strategy_binding.strategy_version).toBe(3)
    expect(manifest.questions.map((question) => question.question_id)).toEqual(v3.questions.map((question) => question.question_id))
    expect(manifest.questions.map((question) => question.candidate_record_hash)).toEqual(v3.questions.map((question) => question.candidate_record_hash))
  })
})
