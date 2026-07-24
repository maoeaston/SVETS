import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildDeliveryContracts } from '../build-job-skill-shelver-delivery-lock.mjs'
import { expectedAnswer, loadDeliveryInputs } from '../lib/job-skill-delivery-contract.mjs'
import { validateVisualAssetManifest } from '../lib/visual-asset-manifest.mjs'

const root = resolve(import.meta.dirname, '../..')
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

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
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path} const mismatch`)
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} enum mismatch`)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.includes(valueType(value))) throw new Error(`${path} expected ${types.join('|')}`)
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${path} too short`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${path} pattern mismatch`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} too few items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} too many items`)
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) throw new Error(`${path} duplicate items`)
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${path}[${index}]`))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${path} missing ${key}`)
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) validateSchema(value[key], child, rootSchema, `${path}.${key}`)
    const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key))
    if (schema.additionalProperties === false && unknown.length > 0) throw new Error(`${path} unknown ${unknown.join(',')}`)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const key of unknown) validateSchema(value[key], schema.additionalProperties, rootSchema, `${path}.${key}`)
    }
  }
}

function assertReverseIndex(toolkit, lock) {
  for (const setup of toolkit.setups) {
    for (const itemId of setup.item_ids) expect(toolkit.reverse_index.item_to_setup_ids[itemId]).toContain(setup.setup_id)
    for (const assetId of setup.asset_ids) expect(toolkit.reverse_index.asset_to_setup_ids[assetId]).toContain(setup.setup_id)
    expect(lock.reverse_index.setup_to_question_id[setup.setup_id]).toBe(setup.current_question_id)
  }
  for (const question of lock.questions) {
    for (const assetId of question.delivery.asset_ids) expect(lock.reverse_index.asset_to_question_ids[assetId]).toContain(question.current_question_id)
  }
}

describe('job skill shelver delivery lock phase 2', () => {
  it('validates both generated contracts and the expanded asset manifest', () => {
    const toolkit = readJson('doc/assets/offline-toolkit-manifest-v1.json')
    const lock = readJson('doc/features/job-skill-shelver-question-delivery-lock-v1.json')
    expect(() => validateSchema(toolkit, readJson('doc/assets/offline-toolkit-manifest-v1.schema.json'))).not.toThrow()
    expect(() => validateSchema(lock, readJson('doc/features/job-skill-shelver-question-delivery-lock-v1.schema.json'))).not.toThrow()
    expect(validateVisualAssetManifest(readJson('doc/assets/asset-manifest.json'), { projectRoot: root }).errors).toEqual([])
  })

  it('binds all 100 retained offline questions, including the 11 approved replacement versions', () => {
    const authority = readJson('doc/features/job-skill-shelver-298-disposition-authority-v1.json')
    const toolkit = readJson('doc/assets/offline-toolkit-manifest-v1.json')
    expect(toolkit.setups).toHaveLength(100)
    expect(toolkit.summary.by_module).toEqual({ M1: 16, M2: 15, M3: 16, M4: 21, M5: 17, M6: 15 })
    expect(new Set(toolkit.setups.map((setup) => setup.current_question_id)).size).toBe(100)
    const replacements = authority.questions.filter((question) => question.disposition === 'REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION')
    expect(replacements).toHaveLength(11)
    expect(toolkit.setups.filter((setup) => replacements.some((replacement) => replacement.source_question_id === setup.source_question_id)))
      .toHaveLength(11)
  })

  it('locks all 68 video answers to the effective question answer', () => {
    const { retained } = loadDeliveryInputs(root)
    const bySource = new Map(retained.map((question) => [question.source_question_id, question]))
    const lock = readJson('doc/features/job-skill-shelver-question-delivery-lock-v1.json')
    expect(lock.summary).toMatchObject({ locked_question_total: 181, offline_setup_total: 100 })
    const videos = lock.questions.filter((question) => question.delivery.types.includes('VIDEO_ANSWER'))
    expect(videos).toHaveLength(68)
    for (const item of videos) expect(item.delivery.expected_answer).toBe(expectedAnswer(bySource.get(item.source_question_id)))
  })

  it('locks 13 online image needs, 4 unique offline answer images, 13 scripts, 20 date setups and 3 audio cues', () => {
    const lock = readJson('doc/features/job-skill-shelver-question-delivery-lock-v1.json')
    const manifest = readJson('doc/assets/asset-manifest.json')
    const count = (type) => lock.questions.filter((question) => question.delivery.types.includes(type)).length
    expect(count('IMAGE_REQUIREMENT')).toBe(13)
    expect(count('OFFLINE_EXAMPLE_IMAGE')).toBe(4)
    expect(count('ROLE_PLAY_SCRIPT')).toBe(13)
    expect(count('AUDIO_CUE')).toBe(3)
    expect(lock.summary.date_question_total).toBe(20)
    const answerImages = manifest.assets.filter((asset) => asset.asset_type === 'answer_image')
    expect(answerImages).toHaveLength(17)
    expect(answerImages.every((asset) => asset.answer_contract_hash && asset.production_contract.unique_per_question)).toBe(true)
  })

  it('keeps every forward reference and reverse index symmetric', () => {
    const toolkit = readJson('doc/assets/offline-toolkit-manifest-v1.json')
    const lock = readJson('doc/features/job-skill-shelver-question-delivery-lock-v1.json')
    expect(() => assertReverseIndex(toolkit, lock)).not.toThrow()
    const broken = structuredClone(lock)
    const firstAsset = broken.questions.find((question) => question.delivery.asset_ids.length > 0).delivery.asset_ids[0]
    broken.reverse_index.asset_to_question_ids[firstAsset] = []
    expect(() => assertReverseIndex(toolkit, broken)).toThrow()
  })

  it('binds source hashes and rebuilds deterministically without touching runtime SQL', () => {
    const toolkit = readJson('doc/assets/offline-toolkit-manifest-v1.json')
    const lock = readJson('doc/features/job-skill-shelver-question-delivery-lock-v1.json')
    for (const source of [...toolkit.source_files, ...lock.sources]) {
      expect(sha256(readFileSync(resolve(root, source.path))), source.path).toBe(source.sha256)
    }
    const generated = buildDeliveryContracts()
    expect(generated.toolkit).toEqual(toolkit)
    expect(generated.lock).toEqual(lock)
    const sqlPath = resolve(root, 'doc/features/question-bank-import.sql')
    const sqlHash = sha256(readFileSync(sqlPath))
    const result = spawnSync(process.execPath, ['scripts/build-job-skill-shelver-delivery-lock.mjs', '--check'], { cwd: root, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(sha256(readFileSync(sqlPath))).toBe(sqlHash)
  })
})
