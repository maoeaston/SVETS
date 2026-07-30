#!/usr/bin/env node

import {
  isolatedEvidenceExists,
  M5bIsolatedDatabaseError,
  runM5bIsolatedDatabaseVerification
} from './lib/m5b-isolated-db.mjs'

function parseArgs(argv) {
  let stage = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--stage' && argv[index + 1]) {
      stage = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`[m5b-isolated-db] unknown argument ${argv[index]}`)
  }
  if (!stage) throw new Error('[m5b-isolated-db] --stage is required')
  return { stage }
}

try {
  const { stage } = parseArgs(process.argv.slice(2))
  const result = await runM5bIsolatedDatabaseVerification({ stage })
  console.log(`[m5b-isolated-db] PASS stage=${result.stage} schema=${result.schemaVersion}`)
  console.log(`[m5b-isolated-db] T11-T14=${result.targetTableCount}, named_indexes=${result.namedIndexCount}`)
  console.log(`[m5b-isolated-db] query_plan=${result.queryPlanIndexes.join(',')}`)
  console.log(`[m5b-isolated-db] backup_db_sha256=${result.backup.databaseHash}`)
  console.log(`[m5b-isolated-db] legacy_sha256=${result.backup.actionLogHash}`)
  if (result.storage) {
    console.log(`[m5b-isolated-db] capability=${result.storage.capability.supported ? 'SUPPORTED' : 'CLOSED'}`)
    console.log(`[m5b-isolated-db] storage_segments=${result.storage.index.segmentCount}, index=${result.storage.index.status}`)
    console.log(`[m5b-isolated-db] legal_legacy_preserved=${result.storage.legacy.preserved}`)
  }
  if (result.command) {
    console.log(`[m5b-isolated-db] command_status=${result.command.status}, generation=${result.command.leaseGeneration}, attempts=${result.command.attemptCount}`)
    console.log(`[m5b-isolated-db] command_secret_absent=${result.command.rawSecretAbsent && result.command.lowCostSecretHashAbsent}`)
    console.log(`[m5b-isolated-db] command_persisted=${result.command.persisted}`)
  }
  if (result.gate) {
    console.log(`[m5b-isolated-db] gate_status=${result.gate.status}, replayed=${result.gate.replayed}, batches=${result.gate.batchCount}`)
  }
  if (result.coordinator) {
    console.log(`[m5b-isolated-db] coordinator_batches=${result.coordinator.batchCount}, events=${result.coordinator.eventCount}`)
    console.log(`[m5b-isolated-db] recovery_planner_calls=${result.coordinator.recoveryPlannerCalls}, attempts=${result.coordinator.recoveredAttemptCount}`)
    console.log(`[m5b-isolated-db] coordinator_relative_sources=${result.coordinator.relativeSources}, persisted=${result.coordinator.persisted}`)
  }
  console.log(`[m5b-isolated-db] temporary_root=${result.paths.runRoot} (removed after PASS)`)
} catch (error) {
  if (error instanceof M5bIsolatedDatabaseError && isolatedEvidenceExists(error)) {
    console.error(`[m5b-isolated-db] evidence preserved at ${error.paths.runRoot}`)
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
