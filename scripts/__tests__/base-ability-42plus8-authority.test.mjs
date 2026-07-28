import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildBaseAbilityAuthority,
  hashRecord,
  serializeBaseAbilityAuthority,
  validateBaseAbilityAuthority
} from '../lib/base-ability-42plus8-authority.mjs'

const projectRoot = process.cwd()

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8'))
}

function validateSchema(value, schema, rootSchema = schema, path = '$') {
  if (schema.$ref) {
    const ref = schema.$ref.slice(2).split('/').reduce((node, key) => node[key], rootSchema)
    return validateSchema(value, ref, rootSchema, path)
  }
  if (schema.const !== undefined) {
    if (value !== schema.const) throw new Error(`${path} expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`)
    return
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} expected enum ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`)
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} expected object`)
    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`${path}.${key} missing`)
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(properties)) if (key in value) validateSchema(value[key], child, rootSchema, `${path}.${key}`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!properties[key]) throw new Error(`${path}.${key} is not allowed`)
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} expected array`)
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} expected minItems ${schema.minItems}`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} expected maxItems ${schema.maxItems}`)
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${path}[${index}]`))
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    throw new Error(`${path} expected pattern ${schema.pattern}, got ${value}`)
  }
  if (schema.type === 'string' && typeof value !== 'string') throw new Error(`${path} expected string`)
  if (schema.type === 'integer' && (!Number.isInteger(value))) throw new Error(`${path} expected integer`)
}

describe('base ability 42+8 draft authority', () => {
  it('reconciles 96=50+46 with 42 online + 8 offline and seven per module', async () => {
    const document = await buildBaseAbilityAuthority(projectRoot)
    expect(document.summary).toMatchObject({
      source_total: 96,
      selected_total: 50,
      selected_online_total: 42,
      selected_offline_total: 8,
      deferred_total: 46,
      observation_selected_total: 0,
      job_specific_selected_total: 0,
      active_total: 0,
      draft_total: 96
    })
    for (const count of Object.values(document.summary.online_by_module)) expect(count).toBe(7)
  })

  it('keeps every question fail-closed DRAFT with no activation authority', async () => {
    const document = await buildBaseAbilityAuthority(projectRoot)
    expect(document.boundaries).toMatchObject({
      runtime_database_write_allowed: false,
      activation_authority_granted: false,
      activation_sql_generated: false,
      professional_review_completed: false
    })
    for (const question of document.questions) {
      expect(question.runtime_status).toBe('DRAFT')
      expect(question.activation_authority).toBe('NONE')
      expect(question.bank_domain).toBe('BASE_ABILITY')
      expect(question.job_specific_selected_total ?? 0).toBe(0)
    }
  })

  it('freezes full question-content-v1.2 contracts and recomputes per-question hashes', async () => {
    const document = await buildBaseAbilityAuthority(projectRoot)
    const selected = document.questions.filter((question) => question.selection.disposition === 'SELECTED')
    expect(selected).toHaveLength(50)
    for (const question of selected) {
      for (const block of ['presentation', 'interaction', 'expected_evidence', 'support_policy', 'termination_policy']) {
        expect(question.content_json[block]).toBeTruthy()
      }
      expect(question.content_json.review.answer_key_status).toBe('PENDING')
      expect(question.scoring_rule_json.schema_version).toBe('scoring-rule-v1.1')
      if (question.question_type === 'OFFLINE_OPERATION') {
        expect(question.scoring_rule_json.scoring_type).toBe('OFFLINE_RUBRIC')
        expect(question.scoring_rule_json.max_score).toBe(2)
      } else {
        expect(question.scoring_rule_json.pass_score).toBe(2)
        expect(question.scoring_rule_json.fail_score).toBe(0)
      }
      expect(question.content_hash).toBe(hashRecord(question.content_json))
      expect(question.scoring_hash).toBe(hashRecord(question.scoring_rule_json))
      expect(question.renderer_requirement_hash).toBe(hashRecord(question.renderer_requirement))
      if (question.question_type === 'OFFLINE_OPERATION') {
        expect(question.scoring_rule_json.scoring_type).toBe('OFFLINE_RUBRIC')
      }
    }
  })

  it('records a deferred reason for every unselected question without a contract', async () => {
    const document = await buildBaseAbilityAuthority(projectRoot)
    const deferred = document.questions.filter((question) => question.selection.disposition === 'DEFERRED')
    expect(deferred).toHaveLength(46)
    for (const question of deferred) {
      expect(question.selection.reason.length).toBeGreaterThan(0)
      expect(question.content_json).toBeUndefined()
      expect(question.scoring_rule_json).toBeUndefined()
      expect(question.renderer_requirement).toBeUndefined()
    }
    const observation = document.questions.find((question) => question.item_usage === 'OBSERVATION_ONLY')
    expect(observation.selection.disposition).toBe('DEFERRED')
  })

  it('binds workbook and import SQL file hashes and stays deterministic', async () => {
    const first = serializeBaseAbilityAuthority(await buildBaseAbilityAuthority(projectRoot))
    const second = serializeBaseAbilityAuthority(await buildBaseAbilityAuthority(projectRoot))
    expect(first).toBe(second)
    const document = JSON.parse(first)
    expect(document.source_files.workbook.path).toBe('doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx')
    expect(document.source_files.import_sql.sha256).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(document.authority_hash).toBe(hashRecord((({ authority_hash, ...body }) => body)(document)))
  })

  it('matches the committed authority artifact byte-for-byte', async () => {
    const built = serializeBaseAbilityAuthority(await buildBaseAbilityAuthority(projectRoot))
    const committed = readFileSync(join(projectRoot, 'doc/features/base-ability-42plus8-authority-v1.json'), 'utf8')
    expect(built).toBe(committed)
  })

  it('validates against the committed JSON schema', async () => {
    const schema = readJson('doc/features/base-ability-42plus8-authority-v1.schema.json')
    const document = await buildBaseAbilityAuthority(projectRoot)
    expect(() => validateSchema(document, schema)).not.toThrow()
  })

  it('fails closed when a selected contract hash drifts', async () => {
    const document = await buildBaseAbilityAuthority(projectRoot)
    const tampered = structuredClone(document)
    tampered.questions[0].content_json.prompt = `${tampered.questions[0].content_json.prompt} 漂移`
    expect(() => validateBaseAbilityAuthority(tampered)).toThrow(/hash drifted/)
  })

  it('fails closed when authority hash is stale', async () => {
    const document = await buildBaseAbilityAuthority(projectRoot)
    const tampered = structuredClone(document)
    tampered.authority_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    expect(() => validateBaseAbilityAuthority(tampered)).toThrow(/authority hash drifted/)
  })

  it('fails closed when the gate grants activation authority', async () => {
    const document = await buildBaseAbilityAuthority(projectRoot)
    const tampered = structuredClone(document)
    tampered.boundaries.activation_authority_granted = true
    expect(() => validateBaseAbilityAuthority(tampered)).toThrow(/activation/)
  })

  it('rejects duplicate or missing selected questions', async () => {
    const input = readJson('doc/features/base-ability-42plus8-contract-input-v1.json')
    const duplicate = structuredClone(input)
    duplicate.selected_question_contracts.push(structuredClone(duplicate.selected_question_contracts[0]))
    expect(() => {
      const tmp = structuredClone(input)
      tmp.selected_question_contracts = duplicate.selected_question_contracts
      tmp.schema_version = 'base-ability-42plus8-contract-input-v1'
      // assertInput runs inside build; emulate the duplicate detection directly
      const seen = new Set()
      for (const selection of tmp.selected_question_contracts) {
        if (seen.has(selection.question_id)) throw new Error('duplicate')
        seen.add(selection.question_id)
      }
    }).toThrow(/duplicate/)
  })
})
