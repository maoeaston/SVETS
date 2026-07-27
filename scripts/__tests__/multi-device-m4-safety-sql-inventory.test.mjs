import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INVENTORY_CLASSES,
  scanProductionSafetySql,
  sqlFingerprint,
  validateSafetySqlInventory
} from '../lib/multi-device-m4-safety-sql-inventory.mjs'

function hit(sql, file = 'src/main/ipc/handlers/example.ts', symbol = 'example') {
  return {
    file,
    symbol,
    line: 1,
    sql,
    sql_fingerprint: sqlFingerprint({ file, symbol, sql })
  }
}

function entry(source, overrides = {}) {
  return {
    id: 'M4-SQL-001',
    file: source.file,
    symbol: source.symbol,
    sql_fingerprint: source.sql_fingerprint,
    classification: 'AGGREGATE_MATCH_REKEY',
    current_predicate: 'student_id + task_code',
    target_predicate: 'student_id + job_code + task_code',
    allowed_reason: 'M4 target fixture',
    test_evidence: ['scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs'],
    status: 'REKEYED',
    ...overrides
  }
}

function inventory(entries) {
  return {
    schema_version: 'multi-device-m4-safety-sql-inventory-v1',
    inventory_version: 'v1',
    entries
  }
}

describe('M4 production safety-SQL inventory', () => {
  it('扫描真实生产源码，并排除 migration 与测试 fixture', () => {
    const projectRoot = process.cwd()
    const hits = scanProductionSafetySql(projectRoot)
    const realInventory = JSON.parse(readFileSync(join(projectRoot, 'doc/features/multi-device-m4-safety-sql-inventory-v1.json'), 'utf8'))
    expect(hits).toHaveLength(48)
    expect(hits.every((source) => source.file.startsWith('src/main/'))).toBe(true)
    const excludedFiles = new Set([
      'src/main/db/migrations.ts',
      'src/main/db/report-migration.ts',
      'src/main/db/safety-rekey-migration.ts',
      'src/main/db/test-helpers.ts'
    ])
    expect(hits.some((source) => source.file.includes('__tests__') || excludedFiles.has(source.file))).toBe(false)
    expect(validateSafetySqlInventory({ hits, inventory: realInventory })).toMatchObject({
      hit_count: 48,
      classification_counts: {
        AGGREGATE_MATCH_REKEY: 9,
        INCIDENT_PRIMARY_KEY_LOOKUP: 18,
        STUDENT_WIDE_LIST: 3,
        NON_SAFETY_QUERY: 18
      }
    })
  })

  it('接受完整、唯一且三元化的 target fixture', () => {
    const source = hit('SELECT 1 FROM safety_incident si WHERE si.student_id = ? AND si.job_code = ? AND si.task_code = ?')
    const result = validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source)]), mode: 'target' })
    expect(result).toMatchObject({ hit_count: 1, pending_rekey: [], aggregate_missing_job_code: [] })
  })

  it('拒绝未登记、重复登记、指纹漂移和非法分类', () => {
    const source = hit('SELECT 1 FROM safety_incident WHERE student_id = ? AND task_code = ?')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([]) })).toThrow('unregistered SQL hit')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source), entry(source, { id: 'M4-SQL-002' })]) })).toThrow('duplicate inventory fingerprint')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source, { sql_fingerprint: 'a'.repeat(64) })]) })).toThrow('unregistered SQL hit')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source, { classification: 'UNKNOWN' })]) })).toThrow('invalid classification')
  })

  it('拒绝尚未 re-key 的二元 aggregate，注释中的 job_code 不算谓词', () => {
    const source = hit('SELECT 1 FROM safety_incident si WHERE si.student_id = ? AND si.task_code = ? /* job_code */')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source, { status: 'PENDING_REKEY' })]), mode: 'target' })).toThrow('target pending re-key')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source)]), mode: 'target' })).toThrow('missing semantic job_code predicate')
  })

  it('冻结分类枚举为 PRD 指定的四类', () => {
    expect(INVENTORY_CLASSES).toEqual([
      'AGGREGATE_MATCH_REKEY',
      'INCIDENT_PRIMARY_KEY_LOOKUP',
      'STUDENT_WIDE_LIST',
      'NON_SAFETY_QUERY'
    ])
  })
})
