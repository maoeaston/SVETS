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
    expect(hits).toHaveLength(68)
    expect(hits.every((source) => source.file.startsWith('src/main/'))).toBe(true)
    expect(hits).toContainEqual(expect.objectContaining({
      file: 'src/main/ipc/handlers/foundation.ts',
      symbol: 'getWorkspaceOverview',
      sql: "SELECT COUNT(*) AS count FROM safety_incident WHERE status IN ('PENDING_DETAIL', 'CONFIRMED')"
    }))
    const commandTargetQueries = hits.filter((source) =>
      source.file === 'src/main/application/command/m5a-command-definitions.ts'
    )
    expect(commandTargetQueries.map(({ symbol }) => symbol).sort()).toEqual([
      'reportGenerationTarget',
      'reportTarget',
      'safetyTarget'
    ])
    expect(commandTargetQueries.map(({ sql_fingerprint }) => {
      const inventoryEntry = realInventory.entries.find((candidate) => candidate.sql_fingerprint === sql_fingerprint)
      return [inventoryEntry?.symbol, inventoryEntry?.classification]
    }).sort(([left], [right]) => left.localeCompare(right))).toEqual([
      ['reportGenerationTarget', 'INCIDENT_PRIMARY_KEY_LOOKUP'],
      ['reportTarget', 'NON_SAFETY_QUERY'],
      ['safetyTarget', 'INCIDENT_PRIMARY_KEY_LOOKUP']
    ])
    const preparedPlannerEntries = realInventory.entries.filter((entry) =>
      entry.file === 'src/main/application/planners/assessment-planner.ts'
      || entry.file === 'src/main/application/planners/training-planner.ts'
      || entry.file === 'src/main/application/planners/safety-planner.ts'
    )
    expect(preparedPlannerEntries).toHaveLength(8)
    expect(preparedPlannerEntries.reduce((counts, entry) => {
      counts[entry.classification] = (counts[entry.classification] ?? 0) + 1
      return counts
    }, {})).toEqual({ AGGREGATE_MATCH_REKEY: 6, NON_SAFETY_QUERY: 1, INCIDENT_PRIMARY_KEY_LOOKUP: 1 })
    const excludedFiles = new Set([
      'src/main/db/migrations.ts',
      'src/main/db/report-migration.ts',
      'src/main/db/safety-rekey-migration.ts',
      'src/main/db/test-helpers.ts'
    ])
    expect(hits.some((source) => source.file.includes('__tests__') || excludedFiles.has(source.file))).toBe(false)
    expect(validateSafetySqlInventory({ hits, inventory: realInventory, mode: 'target' })).toMatchObject({
      hit_count: 68,
      pending_rekey: [],
      aggregate_missing_triple_key: [],
      classification_counts: {
        AGGREGATE_MATCH_REKEY: 15,
        INCIDENT_PRIMARY_KEY_LOOKUP: 26,
        STUDENT_WIDE_LIST: 3,
        NON_SAFETY_QUERY: 24
      }
    })
  })

  it('接受完整、唯一且三元化的 target fixture', () => {
    const source = hit('SELECT 1 FROM safety_incident si WHERE si.student_id = ? AND si.job_code = ? AND si.task_code = ?')
    const result = validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source)]), mode: 'target' })
    expect(result).toMatchObject({ hit_count: 1, pending_rekey: [], aggregate_missing_triple_key: [] })
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
    const pendingSource = hit('SELECT 1 FROM safety_incident si WHERE si.student_id = ? AND si.job_code = ? AND si.task_code = ?')
    expect(() => validateSafetySqlInventory({ hits: [pendingSource], inventory: inventory([entry(pendingSource, { status: 'PENDING_REKEY' })]), mode: 'target' })).toThrow('target pending re-key')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source)]), mode: 'target' })).toThrow('invalid aggregate triple-key contract')
  })

  it('要求三元键约束命中的安全关系，并拒绝无关 alias 或缺键', () => {
    const unrelatedAlias = hit('SELECT 1 FROM safety_incident si JOIN job_catalog jc ON jc.job_code = ? WHERE si.student_id = ? AND si.task_code = ? AND jc.job_code = ?')
    const unrelatedAggregateAlias = hit('SELECT si.incident_id FROM safety_incident si JOIN assessment_session s ON s.session_id = ? WHERE s.student_id = ? AND s.job_code = ? AND s.task_code = ?')
    const missingStudent = hit('SELECT 1 FROM safety_incident si WHERE si.job_code = ? AND si.task_code = ?')
    const missingTask = hit('SELECT 1 FROM safety_incident si WHERE si.student_id = ? AND si.job_code = ?')
    const completeIncidentJoin = hit('SELECT si.incident_id FROM safety_incident si JOIN assessment_session s ON s.student_id = si.student_id AND s.job_code = si.job_code AND s.task_code = si.task_code WHERE s.session_id = ?')

    expect(() => validateSafetySqlInventory({ hits: [unrelatedAlias], inventory: inventory([entry(unrelatedAlias)]), mode: 'target' })).toThrow('invalid aggregate triple-key contract')
    expect(() => validateSafetySqlInventory({ hits: [unrelatedAggregateAlias], inventory: inventory([entry(unrelatedAggregateAlias)]), mode: 'target' })).toThrow('invalid aggregate triple-key contract')
    expect(() => validateSafetySqlInventory({ hits: [missingStudent], inventory: inventory([entry(missingStudent)]), mode: 'target' })).toThrow('invalid aggregate triple-key contract')
    expect(() => validateSafetySqlInventory({ hits: [missingTask], inventory: inventory([entry(missingTask)]), mode: 'target' })).toThrow('invalid aggregate triple-key contract')
    expect(validateSafetySqlInventory({ hits: [completeIncidentJoin], inventory: inventory([entry(completeIncidentJoin)]), mode: 'target' })).toMatchObject({
      aggregate_missing_triple_key: []
    })
  })

  it('强制清单元数据，并拒绝同一函数中被折叠的重复 SQL occurrence', () => {
    const source = hit('SELECT 1 FROM safety_incident si WHERE si.student_id = ? AND si.job_code = ? AND si.task_code = ?')
    const duplicateOccurrence = { ...source, line: 2 }

    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source, { allowed_reason: ' ' })]) })).toThrow('entry allowed_reason is required')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source, { test_evidence: [] })]) })).toThrow('test_evidence is required')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source, { file: 'src/main/ipc/handlers/other.ts' })]) })).toThrow('inventory file mismatch')
    expect(() => validateSafetySqlInventory({ hits: [source], inventory: inventory([entry(source, { symbol: 'other' })]) })).toThrow('inventory symbol mismatch')
    expect(() => validateSafetySqlInventory({ hits: [source, duplicateOccurrence], inventory: inventory([entry(source)]) })).toThrow('duplicate SQL occurrence fingerprint')
  })

  it('对主键查询、只读学生列表和非安全豁免分别执行分类合同', () => {
    const notPrimaryKey = hit('SELECT * FROM safety_incident WHERE student_id = ?', 'src/main/ipc/handlers/safety.ts', 'readIncident')
    const assigningIncidentId = hit('UPDATE safety_incident SET incident_id = ? WHERE student_id = ?', 'src/main/ipc/handlers/safety.ts', 'readIncident')
    const mutatingList = hit("UPDATE safety_incident SET status = 'VOIDED' WHERE incident_id = ?", 'src/main/ipc/handlers/safety.ts', 'listSafetyIncidents')
    const aggregateList = hit('SELECT * FROM safety_incident si WHERE si.student_id = ? AND si.task_code = ?', 'src/main/ipc/handlers/safety.ts', 'listSafetyIncidents')
    const exemptAggregate = hit('SELECT * FROM safety_incident si WHERE si.student_id = ? AND si.task_code = ?', 'src/main/ipc/handlers/safety.ts', 'readIncident')

    expect(() => validateSafetySqlInventory({ hits: [notPrimaryKey], inventory: inventory([entry(notPrimaryKey, { classification: 'INCIDENT_PRIMARY_KEY_LOOKUP' })]) })).toThrow('invalid incident primary-key contract')
    expect(() => validateSafetySqlInventory({ hits: [assigningIncidentId], inventory: inventory([entry(assigningIncidentId, { classification: 'INCIDENT_PRIMARY_KEY_LOOKUP' })]) })).toThrow('invalid incident primary-key contract')
    expect(() => validateSafetySqlInventory({ hits: [mutatingList], inventory: inventory([entry(mutatingList, { classification: 'STUDENT_WIDE_LIST' })]) })).toThrow('student-wide list must be read-only SELECT')
    expect(() => validateSafetySqlInventory({ hits: [aggregateList], inventory: inventory([entry(aggregateList, { classification: 'STUDENT_WIDE_LIST' })]) })).toThrow('student-wide list cannot contain aggregate key predicate')
    expect(() => validateSafetySqlInventory({ hits: [exemptAggregate], inventory: inventory([entry(exemptAggregate, { classification: 'NON_SAFETY_QUERY' })]) })).toThrow('non-safety exemption cannot contain safety aggregate key predicate')
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
