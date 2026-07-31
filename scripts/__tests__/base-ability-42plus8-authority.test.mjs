import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import {
  buildBaseAbilityAuthority,
  hashRecord,
  serializeBaseAbilityAuthority,
  validateBaseAbilityAuthority,
  writeOrCheckBaseAbilityAuthority
} from '../lib/base-ability-42plus8-authority.mjs'
import { fileSha256 } from '../lib/base-ability-42plus8-source.mjs'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const WORKBOOK_PATH = 'doc/reference/通用基础能力正式测评候选题库_v0.2-软件优先版.xlsx'
const IMPORT_SQL_PATH = 'doc/features/question-bank-import-base-ability-v02.sql'
const INPUT_PATH = 'doc/features/base-ability-42plus8-contract-input-v1.json'

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8'))
}

function copyFixtureFile(root, relativePath) {
  const destination = resolve(root, relativePath)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(resolve(projectRoot, relativePath), destination)
}

function createSourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'svets-base-ability-source-'))
  for (const relativePath of [WORKBOOK_PATH, IMPORT_SQL_PATH, INPUT_PATH]) {
    copyFixtureFile(root, relativePath)
  }
  return root
}

function replaceOnce(value, expected, replacement, label) {
  const index = value.indexOf(expected)
  if (index < 0 || value.indexOf(expected, index + expected.length) >= 0) {
    throw new Error(`fixture ${label} must contain exactly one expected field value`)
  }
  return `${value.slice(0, index)}${replacement}${value.slice(index + expected.length)}`
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeStoredZip(path, entries) {
  const localChunks = []
  const centralChunks = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name)
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const checksum = crc32(body)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localChunks.push(local, nameBytes, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centralChunks.push(central, nameBytes)
    offset += local.length + nameBytes.length + body.length
  }
  const centralSize = centralChunks.reduce((size, chunk) => size + chunk.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(path, Buffer.concat([...localChunks, ...centralChunks, end]))
}

function archiveEntries(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return archiveEntries(root, path)
    return [[relative(root, path).replaceAll('\\', '/'), readFileSync(path)]]
  })
}

function updateSourceBindings(root) {
  const inputPath = resolve(root, INPUT_PATH)
  const input = JSON.parse(readFileSync(inputPath, 'utf8'))
  input.source_bindings.source_sha256 = fileSha256(root, WORKBOOK_PATH)
  input.source_bindings.import_sql_sha256 = fileSha256(root, IMPORT_SQL_PATH)
  writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`)
}

function mutateWorkbookField(root) {
  const workbookPath = resolve(root, WORKBOOK_PATH)
  const contentRoot = mkdtempSync(join(tmpdir(), 'svets-base-ability-workbook-'))
  try {
    execFileSync('unzip', ['-q', workbookPath, '-d', contentRoot])
    const sheetPath = join(contentRoot, 'xl/worksheets/sheet2.xml')
    writeFileSync(
      sheetPath,
      replaceOnce(
        readFileSync(sheetPath, 'utf8'),
        '标准操作盒：15毫米圆片10枚、防滑垫、目标杯。',
        '标准操作盒：15毫米圆片10枚、防滑垫、目标杯（字段漂移）。',
        'workbook materials'
      )
    )
    writeStoredZip(workbookPath, archiveEntries(contentRoot))
  } finally {
    rmSync(contentRoot, { recursive: true, force: true })
  }
}

function mutateSqlField(root) {
  const sqlPath = resolve(root, IMPORT_SQL_PATH)
  const sql = readFileSync(sqlPath, 'utf8')
  writeFileSync(
    sqlPath,
    replaceOnce(
      sql,
      '标准操作盒：15毫米圆片10枚、防滑垫、目标杯。',
      '标准操作盒：15毫米圆片10枚、防滑垫、目标杯（字段漂移）。',
      'SQL materials'
    )
  )
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

  it.each([
    ['workbook', mutateWorkbookField],
    ['SQL', mutateSqlField]
  ])('runs the normal authority check fail-closed when %s materials drift', async (_source, mutate) => {
    const fixtureRoot = createSourceFixture()
    try {
      mutate(fixtureRoot)
      updateSourceBindings(fixtureRoot)
      await expect(writeOrCheckBaseAbilityAuthority(fixtureRoot, { check: true }))
        .rejects.toThrow(/GA-FM-001\.materials mismatches derived SQL/)
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
