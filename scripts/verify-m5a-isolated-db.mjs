#!/usr/bin/env node
import { M5aIsolatedDatabaseError, runM5aIsolatedDatabaseVerification } from './lib/m5a-isolated-db.mjs'

try {
  const result = runM5aIsolatedDatabaseVerification()
  console.log(`[m5a-isolated-db] PASS db=${result.dbPath}`)
  console.log(`[m5a-isolated-db] temporary root=${result.evidenceRoot} (removed after PASS)`)
  console.log(`[m5a-isolated-db] schema=${result.schemaVersion} pack=${result.packVersion}`)
  console.log(`[m5a-isolated-db] hash=${result.packHash}`)
} catch (error) {
  if (error instanceof M5aIsolatedDatabaseError && error.evidenceRoot) {
    console.error(`[m5a-isolated-db] evidence preserved at ${error.evidenceRoot}`)
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
