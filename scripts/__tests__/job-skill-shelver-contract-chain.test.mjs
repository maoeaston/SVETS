import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAuthority, verifySourceManifest } from '../build-job-skill-shelver-298-authority.mjs'
import { hashRecord, semanticHash } from '../lib/job-skill-contract-hash.mjs'

const root = resolve(import.meta.dirname, '../..')
const paths = {
  authority: resolve(root, 'doc/features/job-skill-shelver-298-disposition-authority-v1.json'),
  authoritySchema: resolve(root, 'doc/features/job-skill-shelver-298-disposition-authority-v1.schema.json'),
  sourceManifest: resolve(root, 'doc/features/job-skill-shelver-298-source-manifest-v1.json'),
  sourceManifestSchema: resolve(root, 'doc/features/job-skill-shelver-298-source-manifest-v1.schema.json'),
  contentRereview: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  contentRereviewSchema: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-v1.schema.json'),
  safetyRereview: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.json'),
  safetyRereviewSchema: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-v1.schema.json'),
  runtimeSql: resolve(root, 'doc/features/question-bank-import.sql'),
  build: resolve(root, 'scripts/build-job-skill-shelver-298-authority.mjs'),
  check: resolve(root, 'scripts/verify-job-skill-shelver-contract-chain.mjs')
}

const tempDirs = []
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function run(script) {
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
}

function valueType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function validateSchema(value, schema, rootSchema = schema, path = '$') {
  if (schema.$ref) {
    const target = schema.$ref.slice(2).split('/').reduce((current, key) => current[key], rootSchema)
    return validateSchema(value, target, rootSchema, path)
  }
  for (const branch of schema.allOf ?? []) validateSchema(value, branch, rootSchema, path)
  if (schema.anyOf) {
    const matched = schema.anyOf.some((branch) => {
      try {
        validateSchema(value, branch, rootSchema, path)
        return true
      } catch {
        return false
      }
    })
    if (!matched) throw new Error(`${path} does not match anyOf`)
    return
  }
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path} must equal ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} is outside enum`)
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!expected.includes(valueType(value))) throw new Error(`${path} expected ${expected.join('|')}, received ${valueType(value)}`)
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${path} is too short`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${path} pattern mismatch`)
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) throw new Error(`${path} invalid date-time`)
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} below minimum`)
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} has too few items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} has too many items`)
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${path}[${index}]`))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new Error(`${path} missing ${key}`)
    }
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateSchema(value[key], child, rootSchema, `${path}.${key}`)
    }
    const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key))
    if (schema.additionalProperties === false && unknown.length > 0) throw new Error(`${path} unknown properties: ${unknown.join(', ')}`)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const key of unknown) validateSchema(value[key], schema.additionalProperties, rootSchema, `${path}.${key}`)
    }
  }
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('job skill shelver contract chain phase 1', () => {
  it('validates the source manifest and disposition authority against their Schemas', () => {
    expect(() => validateSchema(readJson(paths.sourceManifest), readJson(paths.sourceManifestSchema))).not.toThrow()
    expect(() => validateSchema(readJson(paths.authority), readJson(paths.authoritySchema))).not.toThrow()
    expect(() => validateSchema(readJson(paths.contentRereview), readJson(paths.contentRereviewSchema))).not.toThrow()
    expect(() => validateSchema(readJson(paths.safetyRereview), readJson(paths.safetyRereviewSchema))).not.toThrow()
  })

  it('keeps the accepted source manifest bound to nine immutable files', () => {
    const manifest = readJson(paths.sourceManifest)
    expect(manifest).toMatchObject({
      schema_version: 'job-skill-shelver-298-source-manifest-v1',
      status: 'ACCEPTED_INPUT_HASHES'
    })
    expect(manifest.artifacts).toHaveLength(9)
    expect(new Set(manifest.artifacts.map((artifact) => artifact.artifact_id)).size).toBe(9)
    expect(new Set(manifest.artifacts.map((artifact) => artifact.path)).size).toBe(9)
    for (const artifact of manifest.artifacts) {
      expect(artifact.immutable, artifact.artifact_id).toBe(true)
      expect(sha256(readFileSync(resolve(root, artifact.path))), artifact.path).toBe(artifact.sha256)
    }
  })

  it('reconciles all 298 source questions, including 11 independently reviewed replacements, into one disposition authority', () => {
    const authority = buildAuthority({ write: false })
    expect(authority.summary).toEqual({
      source_total: 298,
      pilot_total: 24,
      non_pilot_total: 274,
      approved_unchanged: 31,
      revised_total: 232,
      rereview_passed: 21,
      rereview_returned: 211,
      rejected: 0,
      replacement_review_passed: 11,
      retained_total: 298,
      by_disposition: {
        APPROVED_UNCHANGED_PENDING_ACTIVATION: 31,
        PILOT_PENDING_GATE: 24,
        REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION: 11,
        REVISED_REREVIEW_PASSED_PENDING_ACTIVATION: 21,
        REVISED_RETURNED: 211
      }
    })
    expect(authority.questions).toHaveLength(298)
    expect(new Set(authority.questions.map((question) => question.source_question_id)).size).toBe(298)
    expect(authority.questions.filter((question) => question.branch === 'PILOT')).toHaveLength(24)
    expect(authority.questions.filter((question) => question.branch === 'NON_PILOT')).toHaveLength(274)
    const replacements = authority.questions.filter((question) => question.disposition === 'REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION')
    expect(replacements).toHaveLength(11)
    expect(replacements.every((question) => question.current_question_id && question.semantic_hash && question.candidate_record_hash && question.activation_authority === 'NONE')).toBe(true)
  })

  it('records a semantic root and fails closed for runtime generation', () => {
    const authority = readJson(paths.authority)
    const { authority_hash: actualHash, ...body } = authority
    expect(actualHash).toBe(hashRecord(body))
    expect(authority.semantic_root_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(authority.release_gate).toMatchObject({
      releaseable: false,
      may_generate_runtime_sql: false
    })
    expect(authority.release_gate.blockers.map((blocker) => blocker.code)).toEqual([
      'PILOT_GATE_PENDING',
      'REREVIEW_RETURNED'
    ])
  })

  it('excludes delivery identifiers from semantic hashes but includes prompt changes', () => {
    const first = semanticHash({
      prompt: '判断商品是否需要下架。',
      scoring_rule: { correct_answer: true },
      media_asset_id: 'asset_old',
      presentation: { type: 'VIDEO_SCENE', assets: [{ asset_id: 'asset_old' }] }
    })
    const deliveryOnly = semanticHash({
      prompt: '判断商品是否需要下架。',
      scoring_rule: { correct_answer: true },
      media_asset_id: 'asset_new',
      presentation: { type: 'VIDEO_SCENE', assets: [{ asset_id: 'asset_new' }] }
    })
    const semanticChange = semanticHash({
      prompt: '判断商品是否已经过期。',
      scoring_rule: { correct_answer: true },
      media_asset_id: 'asset_new',
      presentation: { type: 'VIDEO_SCENE', assets: [{ asset_id: 'asset_new' }] }
    })
    expect(deliveryOnly).toBe(first)
    expect(semanticChange).not.toBe(first)
  })

  it('detects one-byte source drift instead of accepting a new hash implicitly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svets-contract-chain-'))
    tempDirs.push(dir)
    const artifacts = Array.from({ length: 9 }, (_, index) => {
      const path = `source-${index}.txt`
      writeFileSync(join(dir, path), `accepted source ${index}`)
      return {
        artifact_id: `source_${index}`,
        path,
        sha256: sha256(readFileSync(join(dir, path))),
        role: 'SOURCE_SNAPSHOT',
        immutable: true
      }
    })
    const manifest = {
      schema_version: 'job-skill-shelver-298-source-manifest-v1',
      status: 'ACCEPTED_INPUT_HASHES',
      artifacts
    }
    expect(() => verifySourceManifest(manifest, dir)).not.toThrow()
    writeFileSync(join(dir, artifacts[0].path), 'changed by one byte!')
    expect(() => verifySourceManifest(manifest, dir)).toThrow(/hash mismatch/)
  })

  it('builds and checks deterministically without touching runtime SQL', () => {
    const sqlBefore = sha256(readFileSync(paths.runtimeSql))
    const build = run(paths.build)
    expect(build.status, build.stderr).toBe(0)
    const authorityBefore = sha256(readFileSync(paths.authority))
    const check = run(paths.check)
    expect(check.status, check.stderr).toBe(0)
    expect(check.stdout).toContain('authority is current')
    expect(sha256(readFileSync(paths.authority))).toBe(authorityBefore)
    expect(sha256(readFileSync(paths.runtimeSql))).toBe(sqlBefore)
  })
})
