import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const sourcePath = resolve(root, 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json')
const contentMarkdownPath = resolve(root, 'doc/features/job-skill-shelver-298-content-review-result-2026-07-19.md')
const safetyMarkdownPath = resolve(root, 'doc/features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.md')
const conflictResolutionPath = resolve(root, 'doc/features/job-skill-shelver-298-review-conflict-resolution-m5-dg-035-2026-07-20.md')
const contentPath = resolve(root, 'doc/features/job-skill-shelver-298-content-review-result-2026-07-19.json')
const safetyPath = resolve(root, 'doc/features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.json')
const mergedPath = resolve(root, 'doc/features/job-skill-shelver-298-merged-review-decisions-2026-07-19.json')
const candidatesPath = resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json')
const ledgerPath = resolve(root, 'doc/features/job-skill-shelver-298-question-revision-ledger-2026-07-19.md')
const contentSchemaPath = resolve(root, 'doc/features/job-skill-shelver-298-content-review-result-v1.schema.json')
const safetySchemaPath = resolve(root, 'doc/features/job-skill-shelver-298-safety-technical-review-result-v1.schema.json')
const pilotV3Path = resolve(root, 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hashRecord(value) {
  return sha256(JSON.stringify(canonical(value)))
}

function validateSchema(value, schema, rootSchema = schema, path = '$') {
  if (schema.$ref) {
    const target = schema.$ref.slice(2).split('/').reduce((current, key) => current[key], rootSchema)
    return validateSchema(value, target, rootSchema, path)
  }
  if (schema.const !== undefined) expect(value, path).toEqual(schema.const)
  if (schema.enum) expect(schema.enum, path).toContain(value)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value
    expect(types, path).toContain(actual)
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined) expect(value.length, path).toBeGreaterThanOrEqual(schema.minLength)
    if (schema.pattern) expect(value, path).toMatch(new RegExp(schema.pattern))
    if (schema.format === 'date') expect(value, path).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    if (schema.format === 'date-time') expect(Number.isNaN(Date.parse(value)), path).toBe(false)
  }
  if (typeof value === 'number' && schema.minimum !== undefined) expect(value, path).toBeGreaterThanOrEqual(schema.minimum)
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) expect(value.length, path).toBeGreaterThanOrEqual(schema.minItems)
    if (schema.maxItems !== undefined) expect(value.length, path).toBeLessThanOrEqual(schema.maxItems)
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${path}[${index}]`))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) expect(value, path).toHaveProperty(key)
    if (schema.additionalProperties === false) {
      expect(Object.keys(value).filter((key) => !Object.hasOwn(schema.properties ?? {}, key)), path).toEqual([])
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateSchema(value[key], childSchema, rootSchema, `${path}.${key}`)
    }
  }
}

describe('job skill shelver 298 review intake and revision candidates', () => {
  it('keeps both reviewer originals and the 298-question source snapshot byte-identical', () => {
    expect(sha256(readFileSync(sourcePath))).toBe('sha256:7af29b8ab55edfa07f5931fce4721a6777fbf0f5d0f9d68e7028ac8228f4bc98')
    expect(sha256(readFileSync(contentMarkdownPath))).toBe('sha256:aef622f931e48009accd23ee9dae88493fe00d20494a96266511e0d7334c3609')
    expect(sha256(readFileSync(safetyMarkdownPath))).toBe('sha256:da30b736c613630ab58fe403cc3f571844fcabdd10b7699bb23f0f99f350eb1e')
    expect(sha256(readFileSync(conflictResolutionPath))).toBe('sha256:2e76f620632b76439a3f607ea2487f65ed28087085a5c0ae52470e229288e141')
  })

  it('validates both machine-readable results against their JSON Schemas', () => {
    validateSchema(readJson(contentPath), readJson(contentSchemaPath))
    validateSchema(readJson(safetyPath), readJson(safetySchemaPath))
  })

  it('reconciles reviewer identity, set, hashes, conclusions, and summaries', () => {
    const source = new Map(readJson(sourcePath).map((question) => [question.question_id, question]))
    const content = readJson(contentPath)
    const safety = readJson(safetyPath)
    expect(content.reviewer).toMatchObject({ name: '陈晓青', reviewed_date: '2026-07-19' })
    expect(safety.reviewer).toEqual({ name: '赫东', reviewed_date: '2026-07-19' })
    expect(content.questions).toHaveLength(274)
    expect(safety.questions).toHaveLength(274)
    expect(new Set(content.questions.map((question) => question.question_id)).size).toBe(274)
    expect(new Set(safety.questions.map((question) => question.question_id)).size).toBe(274)
    expect(content.questions.map((question) => question.question_id).sort()).toEqual(safety.questions.map((question) => question.question_id).sort())
    for (const question of content.questions) {
      expect(question.source_record_hash, question.question_id).toBe(hashRecord(source.get(question.question_id)))
      expect(question.question_version, question.question_id).toBe(source.get(question.question_id).version)
    }
    expect(content.summary).toMatchObject({ total: 274, approved: 33, return_for_revision: 230, rejected: 11 })
    expect(safety.summary).toMatchObject({
      total: 274,
      safety_pass: 236,
      safety_return_for_revision: 38,
      technical_pass: 203,
      technical_return_for_revision: 71,
      both_pass: 197,
      safety_return_technical_pass: 6,
      safety_pass_technical_return: 39,
      both_return: 32
    })
  })

  it('resolves the contradictory M5_DG_035 record only through the added human decision', () => {
    const merged = readJson(mergedPath)
    expect(merged.summary).toEqual({ total: 274, approved_unchanged: 31, revision_required: 232, rejected: 11, blocked_conflict: 0 })
    expect(merged.questions).toHaveLength(274)
    expect(merged.questions.filter((question) => question.conflicts.length > 0)).toEqual([])
    expect(merged.questions.find((question) => question.question_id === 'M5_DG_035')).toMatchObject({
      merged_decision: 'REVISION_REQUIRED',
      resolved_conflicts: [expect.objectContaining({
        resolution_id: 'job-skill-shelver-298-m5-dg-035-conflict-resolution-2026-07-20',
        source_file_hash: 'sha256:2e76f620632b76439a3f607ea2487f65ed28087085a5c0ae52470e229288e141'
      })]
    })
  })

  it('creates fail-closed versioned candidates without overwriting source semantics', () => {
    const source = new Map(readJson(sourcePath).map((question) => [question.question_id, question]))
    const merged = readJson(mergedPath)
    const candidates = readJson(candidatesPath)
    expect(candidates.summary).toEqual({
      source_reviewed_total: 274,
      candidates_total: 263,
      approved_unchanged: 31,
      revised_new_versions: 232,
      structured_revision_applied: 202,
      requirements_bound_revision_pending: 30,
      rejected_excluded: 11,
      blocked_conflict_excluded: 0,
      semantic_change_re_review_pending: 232
    })
    expect(candidates.authority).toEqual({
      source_snapshot_immutable: true,
      historical_review_results_immutable: true,
      pilot_v3_unchanged: true,
      runtime_database_unchanged: true,
      activation_sql_generated: false
    })
    expect(candidates.questions.every((question) => question.status === 'DRAFT' && question.activation_authority === 'NONE')).toBe(true)

    const rejected = new Set(merged.questions.filter((question) => question.merged_decision === 'REJECTED').map((question) => question.question_id))
    expect(candidates.questions.some((question) => rejected.has(question.source_question_id))).toBe(false)

    for (const candidate of candidates.questions) {
      const sourceQuestion = source.get(candidate.source_question_id)
      const { candidate_record_hash: recordHash, ...record } = candidate
      expect(recordHash, candidate.question_id).toBe(hashRecord(record))
      if (candidate.merged_decision === 'REVISION_REQUIRED') {
        expect(candidate.question_id, candidate.source_question_id).toBe(`${candidate.source_question_id}_V2`)
        expect(candidate.previous_question_id).toBe(candidate.source_question_id)
        expect(candidate.question_version).toBe(sourceQuestion.version + 1)
        expect(candidate.revision_application.semantic_change_re_review_required).toBe(true)
      } else {
        expect(candidate.question_id).toBe(candidate.source_question_id)
        expect(candidate.question_version).toBe(sourceQuestion.version)
        expect(candidate.previous_question_id).toBeNull()
        expect(candidate.proposed_question.content).toEqual(JSON.parse(sourceQuestion.content_json))
        expect(candidate.proposed_question.scoring_rule).toEqual(JSON.parse(sourceQuestion.scoring_rule_json))
      }
    }

    const { candidate_set_hash: setHash, ...setRecord } = candidates
    expect(setHash).toBe(hashRecord(setRecord))
  })

  it('applies reviewable structural fixes to representative revised questions', () => {
    const candidates = readJson(candidatesPath)
    const trueFalse = candidates.questions.find((question) => question.question_id === 'M1_TF_015_V2')
    expect(trueFalse.proposed_question.content).toMatchObject({
      prompt: '观看视频，判断该做法是否符合门店规范。',
      expected_answer: true
    })
    const offline = candidates.questions.find((question) => question.question_id === 'M1_OP_034_V2')
    expect(offline.proposed_question.scoring_rule).toMatchObject({
      score_0_description: expect.stringContaining('核心任务未完成'),
      score_1_description: expect.stringContaining('完成部分关键指标'),
      score_2_description: expect.stringContaining('全部关键指标完成')
    })
    expect(offline.revision_application.semantic_change_re_review_required).toBe(true)
    const resolvedDrag = candidates.questions.find((question) => question.question_id === 'M5_DG_035_V2')
    expect(resolvedDrag.proposed_question.content.drag_items.find((item) => item.item_id === 'i3').label).toBe('复述确认并执行指示')
    expect(resolvedDrag.proposed_question.content.drop_zones.map((zone) => zone.accepts)).toEqual([['i2'], ['i1'], ['i3']])
    expect(resolvedDrag.proposed_question.safety_sensitive).toBe(true)
    expect(resolvedDrag.proposed_question.safety_stop_conditions).toContain('先采取本人权限内的现场控制措施')
    expect(resolvedDrag.review_result_refs.conflict_resolution_id).toBe('job-skill-shelver-298-m5-dg-035-conflict-resolution-2026-07-20')
  })

  it('rebuilds deterministically without touching Pilot v3 or source files', () => {
    const before = {
      source: sha256(readFileSync(sourcePath)),
      contentOriginal: sha256(readFileSync(contentMarkdownPath)),
      safetyOriginal: sha256(readFileSync(safetyMarkdownPath)),
      conflictResolution: sha256(readFileSync(conflictResolutionPath)),
      pilotV3: sha256(readFileSync(pilotV3Path)),
      candidates: sha256(readFileSync(candidatesPath)),
      ledger: sha256(readFileSync(ledgerPath))
    }
    const rebuild = spawnSync(process.execPath, [resolve(root, 'scripts/build-job-skill-shelver-298-revisions.mjs')], { cwd: root })
    if (rebuild.status !== 0) {
      throw rebuild.error ?? new Error(rebuild.stderr?.toString() || `rebuild exited ${rebuild.status}`)
    }
    expect(sha256(readFileSync(sourcePath))).toBe(before.source)
    expect(sha256(readFileSync(contentMarkdownPath))).toBe(before.contentOriginal)
    expect(sha256(readFileSync(safetyMarkdownPath))).toBe(before.safetyOriginal)
    expect(sha256(readFileSync(conflictResolutionPath))).toBe(before.conflictResolution)
    expect(sha256(readFileSync(pilotV3Path))).toBe(before.pilotV3)
    expect(sha256(readFileSync(candidatesPath))).toBe(before.candidates)
    expect(sha256(readFileSync(ledgerPath))).toBe(before.ledger)
  })
})
