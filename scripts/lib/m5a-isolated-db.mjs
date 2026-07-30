import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { syncDatabase, verifyDatabase } from './database-content-pack.mjs'

export class M5aIsolatedDatabaseError extends Error {
  constructor(message, { evidenceRoot = null, dbPath = null, cause } = {}) {
    super(message, { cause })
    this.name = 'M5aIsolatedDatabaseError'
    this.evidenceRoot = evidenceRoot
    this.dbPath = dbPath
  }
}

export const M5A_ISOLATED_DB_PARENT = '/tmp'

export function runM5aIsolatedDatabaseVerification({
  parentDir = M5A_ISOLATED_DB_PARENT,
  sync = syncDatabase,
  verify = verifyDatabase
} = {}) {
  let evidenceRoot = null
  let dbPath = null
  try {
    evidenceRoot = mkdtempSync(join(resolve(parentDir), 'svets-m5a-isolated-db-'))
    dbPath = join(evidenceRoot, 'data', 'xc-career-guide.db')

    const syncResult = sync(dbPath)
    if (resolve(syncResult.dbPath) !== resolve(dbPath)) {
      throw new Error(`sync returned a different database path: ${syncResult.dbPath}`)
    }
    if (!existsSync(dbPath)) throw new Error('sync did not create the isolated database')

    const verification = verify(dbPath)
    if (!verification?.ok) {
      const issues = Array.isArray(verification?.issues) ? verification.issues.join('; ') : 'unknown verification failure'
      throw new Error(`isolated database verification failed: ${issues}`)
    }
    if (resolve(verification.dbPath) !== resolve(dbPath)) {
      throw new Error(`verify returned a different database path: ${verification.dbPath}`)
    }

    const result = {
      ok: true,
      evidenceRoot,
      dbPath,
      schemaVersion: verification.schemaVersion,
      packVersion: verification.packVersion,
      packHash: verification.packHash,
      counts: verification.counts,
      approvedAssetCount: verification.approvedAssetCount,
      cleaned: true
    }
    rmSync(evidenceRoot, { recursive: true, force: true })
    return result
  } catch (cause) {
    throw new M5aIsolatedDatabaseError(
      `[m5a-isolated-db] FAIL: ${cause instanceof Error ? cause.message : String(cause)}`,
      { evidenceRoot, dbPath, cause }
    )
  }
}

export function evidenceRootForDatabase(dbPath) {
  return dirname(dirname(dbPath))
}
