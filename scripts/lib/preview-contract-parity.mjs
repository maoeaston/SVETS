import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import initSqlJs from 'sql.js'

import {
  contentPack as defaultContentPack,
  migrationLedgerDigest as contentPackLedgerDigest,
  projectRoot,
  verifyDatabase
} from './database-content-pack.mjs'
import {
  assertExactEventBatchStructure,
  EVENT_BATCH_MIGRATION_ID,
  EVENT_BATCH_OBJECT_DIGEST,
  EVENT_BATCH_OBJECT_NAMES,
  EVENT_BATCH_SCHEMA_VERSION,
  EVENT_BATCH_TARGET_LEDGER,
  EVENT_BATCH_TARGET_LEDGER_DIGEST,
  eventBatchStructureIssues,
  inspectEventBatchStructure,
  migrationLedgerDigest as eventBatchLedgerDigest
} from '../../src/main/db/event-batch-migration.ts'
import { PREVIEW_CONTRACT_MIGRATION_ID } from '../../src/shared/types/preview-contract.ts'
import { PREVIEW_CONTRACT_SCHEMA_VERSION } from '../../src/main/db/preview-contract-migration.ts'
import { runM5bIsolatedDatabaseVerification } from './m5b-isolated-db.mjs'

const PREVIEW_CONTRACT_NOT_READY = 'PREVIEW_CONTRACT_NOT_READY'

class SqlJsReadAdapter {
  constructor(database) {
    this.database = database
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

  prepare(sql) {
    return {
      get: (...params) => this.query(sql, params)[0],
      all: (...params) => this.query(sql, params)
    }
  }
}

function objectDigest(names) {
  return createHash('sha256').update(names.join('\n')).digest('hex')
}

function canonicalLedger(entries) {
  return entries
    .map((entry) => ({
      migrationId: entry.migrationId ?? entry.migration_id,
      schemaVersion: entry.schemaVersion ?? entry.schema_version
    }))
    .sort((left, right) => left.migrationId.localeCompare(right.migrationId))
}

function ledgerMatches(actual, expected) {
  return JSON.stringify(canonicalLedger(actual)) === JSON.stringify(canonicalLedger(expected))
}

const PREVIEW_CONTRACT_TARGET_LEDGER = [
  ...EVENT_BATCH_TARGET_LEDGER,
  { migrationId: PREVIEW_CONTRACT_MIGRATION_ID, schemaVersion: PREVIEW_CONTRACT_SCHEMA_VERSION }
]

function expectedObjectNames() {
  return [...EVENT_BATCH_OBJECT_NAMES]
}

function readLedger(adapter) {
  const table = adapter
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration'")
    .get()
  if (Number(table?.count ?? 0) !== 1) return []
  return adapter
    .prepare('SELECT migration_id AS migrationId, schema_version AS schemaVersion FROM schema_migration ORDER BY migration_id')
    .all()
}

function readM5bObjectNames(adapter) {
  const expected = new Set(expectedObjectNames())
  return adapter
    .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all()
    .map(({ type, name }) => `${type}:${name}`)
    .filter((name) => expected.has(name))
    .sort()
}

function inspectM5bDatabase(dbPath) {
  const databaseBytes = readFileSync(dbPath)
  return initSqlJs({
    locateFile: (file) => resolve(projectRoot, 'node_modules', 'sql.js', 'dist', file)
  }).then((SQL) => {
    const database = new SQL.Database(databaseBytes)
    try {
      const adapter = new SqlJsReadAdapter(database)
      const structure = inspectEventBatchStructure(adapter)
      const ledger = readLedger(adapter)
      const m5bLedger = ledger.filter(({ migrationId }) =>
        EVENT_BATCH_TARGET_LEDGER.some((entry) => entry.migrationId === migrationId)
      )
      const objects = readM5bObjectNames(adapter)
      const snapshot = {
        schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
        migrationId: EVENT_BATCH_MIGRATION_ID,
        structure,
        ledger,
        ledgerDigest: eventBatchLedgerDigest(m5bLedger),
        actualLedgerDigest: eventBatchLedgerDigest(ledger),
        expectedLedgerDigest: EVENT_BATCH_TARGET_LEDGER_DIGEST,
        objectNames: objects,
        objectDigest: objectDigest(objects),
        expectedObjectDigest: EVENT_BATCH_OBJECT_DIGEST
      }

      if (structure !== 'CURRENT') {
        return {
          ...snapshot,
          ok: false,
          code: 'M5B_SCHEMA_DRIFT',
          issues: structure === 'ABSENT'
            ? expectedObjectNames().map((name) => `missing:${name}`)
            : eventBatchStructureIssues(adapter)
        }
      }

      try {
        assertExactEventBatchStructure(adapter)
      } catch (error) {
        return {
          ...snapshot,
          ok: false,
          code: error?.code ?? 'M5B_SCHEMA_DRIFT',
          issues: error?.issues ?? [error instanceof Error ? error.message : String(error)]
        }
      }

      if (!ledgerMatches(ledger, EVENT_BATCH_TARGET_LEDGER)
        && !ledgerMatches(ledger, PREVIEW_CONTRACT_TARGET_LEDGER)) {
        return {
          ...snapshot,
          ok: false,
          code: 'M5B_LEDGER_DRIFT',
          issues: ['ledger:target']
        }
      }
      if (objectDigest(objects) !== EVENT_BATCH_OBJECT_DIGEST) {
        return {
          ...snapshot,
          ok: false,
          code: 'M5B_SCHEMA_DRIFT',
          issues: ['object-inventory:target']
        }
      }
      return { ...snapshot, ok: true, code: null, issues: [] }
    } finally {
      database.close()
    }
  })
}

function inspectContentPackMetadata(pack) {
  const issues = []
  const expectedLedger = PREVIEW_CONTRACT_TARGET_LEDGER
  if (pack.schemaVersion !== PREVIEW_CONTRACT_SCHEMA_VERSION) {
    issues.push(`schema-version:${pack.schemaVersion ?? 'missing'}`)
  }
  if (pack.migrationId !== PREVIEW_CONTRACT_MIGRATION_ID) {
    issues.push(`migration-id:${pack.migrationId ?? 'missing'}`)
  }
  if (!Array.isArray(pack.requiredMigrationLedger) || !ledgerMatches(pack.requiredMigrationLedger, expectedLedger)) {
    issues.push('required-ledger:target')
  }
  return {
    ok: issues.length === 0,
    issues,
    version: pack.version ?? null,
    schemaVersion: pack.schemaVersion ?? null,
    migrationId: pack.migrationId ?? null,
    ledgerCount: Array.isArray(pack.requiredMigrationLedger) ? pack.requiredMigrationLedger.length : 0,
    ledgerDigest: Array.isArray(pack.requiredMigrationLedger)
      ? contentPackLedgerDigest(pack.requiredMigrationLedger)
      : null,
    expectedLedgerDigest: contentPackLedgerDigest(expectedLedger)
  }
}

async function verifyIsolatedM5b() {
  const result = await runM5bIsolatedDatabaseVerification({ stage: 'schema' })
  const migration = result.migration ?? {}
  const ok = result.ok === true
    && result.schemaVersion === EVENT_BATCH_SCHEMA_VERSION
    && migration.source === 'EXACT_M4'
    && migration.applied === true
    && result.targetTableCount === 4
    && result.namedIndexCount === 3
  return {
    ok,
    status: ok ? 'PASS' : 'FAIL',
    schemaVersion: result.schemaVersion ?? null,
    migration,
    ledgerDigest: EVENT_BATCH_TARGET_LEDGER_DIGEST,
    objectDigest: EVENT_BATCH_OBJECT_DIGEST,
    issues: ok ? [] : ['isolated-m5b-target-mismatch']
  }
}

/**
 * Step 0 parity only. A parity PASS deliberately leaves the preview contract
 * unavailable until the later projection/registry/migration ready gate.
 */
export async function verifyPreviewContractParity({
  dbPath,
  contentPack = defaultContentPack,
  includeIsolatedM5b = false
} = {}) {
  if (!dbPath || !isAbsolute(dbPath)) {
    throw new Error('[preview-parity] an explicit absolute --db path is required')
  }
  if (!existsSync(dbPath)) throw new Error(`[preview-parity] database does not exist: ${dbPath}`)

  const contentPackMetadata = inspectContentPackMetadata(contentPack)
  const m5b = await inspectM5bDatabase(dbPath)
  const content = contentPackMetadata.ok && contentPack === defaultContentPack
    ? verifyDatabase(dbPath, { throwOnError: false })
    : null
  const isolated = includeIsolatedM5b ? await verifyIsolatedM5b() : null
  const issues = []

  if (!contentPackMetadata.ok) {
    issues.push({ code: 'PARITY_REQUIRED', details: contentPackMetadata.issues })
  }
  if (!m5b.ok) issues.push({ code: m5b.code, details: m5b.issues })
  if (content && !content.ok) issues.push({ code: 'PARITY_REQUIRED', details: content.issues })
  if (isolated && !isolated.ok) issues.push({ code: 'M5B_SCHEMA_DRIFT', details: isolated.issues })

  const primary = issues[0]?.code ?? null
  return {
    status: issues.length === 0 ? 'PASS' : primary === 'PARITY_REQUIRED' ? 'BLOCKED' : 'FAIL',
    code: primary,
    dbPath,
    preview_contract: 'NOT_READY',
    preview_contract_code: PREVIEW_CONTRACT_NOT_READY,
    content_pack: contentPackMetadata,
    content_verifier: content
      ? { status: content.ok ? 'PASS' : 'FAIL', issues: content.issues, packHash: content.packHash }
      : { status: contentPackMetadata.ok ? 'NOT_RUN' : 'BLOCKED', issues: [] },
    m5b,
    isolated_verifier: isolated,
    ledger_digest: {
      content_pack: contentPackMetadata.ledgerDigest,
      m5b: m5b.ledgerDigest,
      target: contentPackMetadata.expectedLedgerDigest,
      m5b_target: EVENT_BATCH_TARGET_LEDGER_DIGEST
    },
    object_digest: {
      m5b: m5b.objectDigest,
      target: EVENT_BATCH_OBJECT_DIGEST
    },
    unmet: [PREVIEW_CONTRACT_NOT_READY, ...issues.map(({ code: issueCode }) => issueCode)]
  }
}
