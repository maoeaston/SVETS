import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import {
  prepareBundledQuestionSql,
  seedBundledQuestionContent,
  type BundledQuestionContract
} from '../content-pack-seed'

const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
const contracts: BundledQuestionContract[] = [
  {
    domain: 'BASE_ABILITY',
    expectedCount: 96,
    sql: readFileSync(resolve(process.cwd(), 'doc/features/question-bank-import-base-ability-v02.sql'), 'utf8')
  },
  {
    domain: 'JOB_SPECIFIC',
    expectedCount: 298,
    sql: readFileSync(resolve(process.cwd(), 'doc/features/question-bank-import.sql'), 'utf8')
  }
]

let db: MemoryAdapter

beforeEach(async () => {
  db = await MemoryAdapter.create()
  db.exec(schema)
})

afterEach(() => db.close())

describe('bundled question content startup seed', () => {
  it('loads 96+298 into an empty database and activates only the fixed JOB_SKILL 18+6 set', () => {
    const result = seedBundledQuestionContent(db, contracts)
    const counts = db.prepare(
      `SELECT bank_domain, status, COUNT(*) AS count
         FROM question_bank
        GROUP BY bank_domain, status
        ORDER BY bank_domain, status`
    ).all()

    expect(result.domains).toEqual([
      { domain: 'BASE_ABILITY', seeded: true, count: 96 },
      { domain: 'JOB_SPECIFIC', seeded: true, count: 298 }
    ])
    expect(result.jobSkillDemo).toEqual({ ready: true, activeCount: 24, reason: null })
    expect(db.prepare(
      `SELECT version FROM strategy_config WHERE strategy_id = 'strategy_job_skill_shelver_v1' AND is_active = 1`
    ).get()).toEqual({ version: 3 })
    expect(counts).toEqual([
      { bank_domain: 'BASE_ABILITY', status: 'DRAFT', count: 96 },
      { bank_domain: 'JOB_SPECIFIC', status: 'ACTIVE', count: 24 },
      { bank_domain: 'JOB_SPECIFIC', status: 'DRAFT', count: 274 }
    ])
  })

  it('does not overwrite an existing domain on restart', () => {
    seedBundledQuestionContent(db, contracts)
    db.prepare(
      `UPDATE question_bank SET content_json = '{"local":"preserved"}' WHERE question_id = 'GA-FM-001'`
    ).run()

    const second = seedBundledQuestionContent(db, contracts)

    expect(second.domains.every((item) => item.seeded === false)).toBe(true)
    expect((db.prepare(
      `SELECT content_json FROM question_bank WHERE question_id = 'GA-FM-001'`
    ).get() as { content_json: string }).content_json).toBe('{"local":"preserved"}')
  })

  it('rolls back one incomplete domain instead of leaving a half pack', () => {
    const broken = contracts[0].sql.replace('COMMIT;', 'THIS IS NOT SQL;\nCOMMIT;')

    expect(() => seedBundledQuestionContent(db, [{ ...contracts[0], sql: broken }]))
      .toThrow('one or more bundled question domains failed to seed')
    expect((db.prepare(
      `SELECT COUNT(*) AS count FROM question_bank WHERE bank_domain = 'BASE_ABILITY'`
    ).get() as { count: number }).count).toBe(0)
  })

  it('removes source transaction and delete statements and rejects other destructive SQL', () => {
    const prepared = prepareBundledQuestionSql("BEGIN;\nDELETE FROM question_bank WHERE bank_domain='BASE_ABILITY';\nSELECT 1;\nCOMMIT;")
    expect(prepared).toContain('SELECT 1;')
    expect(prepared).not.toMatch(/BEGIN|COMMIT|DELETE/i)
    expect(() => prepareBundledQuestionSql('DELETE FROM user_account;')).toThrow('destructive')
  })
})
