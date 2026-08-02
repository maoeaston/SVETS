import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import initSqlJs from 'sql.js'

import {
  inspectPreviewContractStructure,
  previewContractIntegrityIssues,
  previewContractMigrationState,
  previewContractStructureDigest,
  PREVIEW_CONTRACT_SCHEMA_VERSION
} from '../../src/main/db/preview-contract-migration.ts'
import { PREVIEW_CONTRACT_MIGRATION_ID } from '../../src/shared/types/preview-contract.ts'
import { previewContractReadiness } from '../../src/main/domain/preview/preview-ready-gate.ts'
import { validatePreviewContractIpcInventory } from './preview-contract-ipc-inventory.mjs'
import { verifyPreviewContractParity } from './preview-contract-parity.mjs'

class SqlJsReadAdapter {
  constructor(database) {
    this.database = database
  }

  prepare(sql) {
    return {
      get: (...params) => this.query(sql, params)[0],
      all: (...params) => this.query(sql, params)
    }
  }

  query(sql, params) {
    const statement = this.database.prepare(sql)
    const rows = []
    try {
      statement.bind(params)
      while (statement.step()) rows.push(statement.getAsObject())
      return rows
    } finally {
      statement.free()
    }
  }
}

async function openDatabase(dbPath) {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
  })
  return new SQL.Database(readFileSync(dbPath))
}

export async function verifyPreviewContractReady({ dbPath } = {}) {
  if (!dbPath || !isAbsolute(dbPath)) throw new Error('[preview-ready] an explicit absolute --db path is required')
  if (!existsSync(dbPath)) throw new Error(`[preview-ready] database does not exist: ${dbPath}`)

  const database = await openDatabase(dbPath)
  try {
    const adapter = new SqlJsReadAdapter(database)
    const readiness = previewContractReadiness('READY')
    let ipcInventory = null
    let ipcInventoryIssue = null
    try {
      ipcInventory = validatePreviewContractIpcInventory(process.cwd()).actual
    } catch (error) {
      ipcInventoryIssue = error instanceof Error ? error.message : String(error)
    }
    const parity = await verifyPreviewContractParity({ dbPath, includeIsolatedM5b: false })
    const structureIssues = inspectPreviewContractStructure(adapter)
    const structureDigest = previewContractStructureDigest(adapter)
    const integrityIssues = previewContractIntegrityIssues(adapter)
    const migrationState = previewContractMigrationState(adapter)
    const registry = adapter.prepare(
      `SELECT status, contract_version, schema_version, migration_id,
              event_registry_digest, projection_digest, query_digest,
              recovery_digest, error_map_digest
         FROM preview_contract_registry
        WHERE registry_id = 'PREVIEW_CONTRACT_V1'`
    ).get()
    const issues = [...structureIssues]
    if (parity.status !== 'PASS') {
      const parityIssues = parity.unmet.filter((issue) => issue !== 'PREVIEW_CONTRACT_NOT_READY')
      issues.push(...(parityIssues.length > 0 ? parityIssues : ['parity:failed']))
    }
    if (ipcInventoryIssue) issues.push('ipc-inventory:' + ipcInventoryIssue)
    if (migrationState !== 'CURRENT') issues.push(`migration-state:${migrationState}`)
    issues.push(...integrityIssues)
    if (!registry) issues.push('registry:PREVIEW_CONTRACT_V1')
    else {
      if (registry.status !== 'READY') issues.push(`registry:status:${registry.status}`)
      if (registry.contract_version !== readiness.contract_version) issues.push('registry:contract_version')
      if (registry.schema_version !== PREVIEW_CONTRACT_SCHEMA_VERSION) issues.push('registry:schema_version')
      if (registry.migration_id !== PREVIEW_CONTRACT_MIGRATION_ID) issues.push('registry:migration_id')
      for (const field of ['event_registry_digest', 'projection_digest', 'query_digest', 'recovery_digest', 'error_map_digest']) {
        if (registry[field] !== readiness[field]) issues.push(`registry:${field}`)
      }
    }
    const ok = issues.length === 0
    return {
      status: ok ? 'PASS' : 'FAIL',
      code: ok ? null : 'PREVIEW_CONTRACT_NOT_READY',
      dbPath,
      preview_contract: ok ? 'READY' : 'NOT_READY',
      migration_state: migrationState,
      registry: registry ?? null,
      readiness,
      parity: {
        status: parity.status,
        code: parity.code,
        unmet: parity.unmet
      },
      ipc_source_digest: ipcInventory?.source_digest ?? null,
      structure_digest: structureDigest,
      ipc_counts: ipcInventory
        ? {
            channels: ipcInventory.source_sets.channels.length,
            reads: ipcInventory.source_sets.reads.length,
            mutations: ipcInventory.source_sets.mutations.length
          }
        : null,
      structure_issues: structureIssues,
      integrity_issues: integrityIssues,
      unmet: issues
    }
  } finally {
    database.close()
  }
}
