import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/build-job-skill-shelver-298-rejected-reconsideration.mjs')
const inputs = [
  'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json',
  'doc/features/job-skill-shelver-298-source-manifest-v1.json',
  'doc/features/job-skill-shelver-298-disposition-authority-v1.json',
  'doc/features/job-skill-shelver-298-merged-review-decisions-2026-07-19.json',
  'doc/features/job-skill-shelver-298-content-review-result-2026-07-19.json',
  'doc/features/job-skill-shelver-298-safety-technical-review-result-2026-07-19.json'
]
const outputs = [
  'doc/features/job-skill-shelver-298-rejected-11-reconsideration-cases-v1.json',
  'doc/features/job-skill-shelver-298-rejected-11-reconsideration-gate-v1.json',
  'doc/features/job-skill-shelver-298-rejected-11-content-reconsideration-packet-chen-xiaoqing-v1.html',
  'doc/features/job-skill-shelver-298-rejected-11-safety-technical-reconsideration-packet-he-dong-v1.html',
  'doc/features/job-skill-shelver-298-rejected-11-content-reconsideration-result-v1.schema.json',
  'doc/features/job-skill-shelver-298-rejected-11-safety-technical-reconsideration-result-v1.schema.json'
]
const expectedIds = ['M1_OB_048', 'M1_OP_042', 'M3_OP_056', 'M4_OP_043', 'M4_OP_044', 'M4_OP_045', 'M4_OP_046', 'M4_OP_047', 'M4_OP_048', 'M5_OP_048', 'M5_OP_055']
let tempRoot

function copy(relative) {
  const target = resolve(tempRoot, relative)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(resolve(root, relative), target, { recursive: true })
}
function json(relative) { return JSON.parse(readFileSync(resolve(tempRoot, relative), 'utf8')) }

beforeEach(() => {
  tempRoot = mkdtempSync(resolve(tmpdir(), 'svets-rejected-reconsideration-'))
  for (const relative of [...inputs, ...outputs]) copy(relative)
})
afterEach(() => rmSync(tempRoot, { recursive: true, force: true }))

describe('job skill shelver rejected 11 reconsideration packets', () => {
  it('binds exactly the 11 rejected V1 originals and keeps authority fail-closed', () => {
    const cases = json(outputs[0])
    const gate = json(outputs[1])
    expect(cases.questions.map((question) => question.question_id)).toEqual(expectedIds)
    expect(cases.questions.every((question) => question.question_version === 1 && question.current_authority.disposition === 'REJECTED')).toBe(true)
    expect(new Set(cases.questions.map((question) => question.source_record_hash)).size).toBe(11)
    expect(gate).toMatchObject({ status: 'PENDING_INDEPENDENT_RECONSIDERATION', summary: { total: 11, pending: 11, eligible_for_authority_amendment: 0 }, boundaries: { existing_passed_287_unchanged: true, runtime_database_unchanged: true, activation_sql_not_generated: true } })
  })

  it('generates self-contained packets with both reviewer identities and all decisions', () => {
    for (const relative of outputs.slice(2, 4)) {
      const html = readFileSync(resolve(tempRoot, relative), 'utf8')
      expect(html).toContain('PASS_AS_IS')
      expect(html).toContain('RETURN_FOR_REDESIGN')
      expect(html).toContain('CONFIRM_REJECTED')
      for (const id of expectedIds) expect(html).toContain(id)
    }
    expect(readFileSync(resolve(tempRoot, outputs[2]), 'utf8')).toContain('陈晓青')
    expect(readFileSync(resolve(tempRoot, outputs[3]), 'utf8')).toContain('赫东')
  })

  it('rejects generated artifact drift', () => {
    const path = resolve(tempRoot, outputs[2])
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n`)
    const result = spawnSync(process.execPath, [script, '--check'], { cwd: root, env: { ...process.env, SVETS_REJECTED_RECONSIDERATION_ROOT: tempRoot }, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('generated artifact drift')
  })

  it('rejects source snapshot byte drift before rebuilding packets', () => {
    const path = resolve(tempRoot, inputs[0])
    writeFileSync(path, `${readFileSync(path, 'utf8')} `)
    const result = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, SVETS_REJECTED_RECONSIDERATION_ROOT: tempRoot }, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('source snapshot bytes drifted')
  })
})
