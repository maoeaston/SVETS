#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = join(projectRoot, 'scripts', 'fixtures')

function readJson(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'))
}

function writeJson(name, value) {
  writeFileSync(join(fixtureRoot, name), `${JSON.stringify(value, null, 2)}\n`)
}

const active = readJson('m5a-command-boundary-active-v1.json')
const legacy = readJson('m5a-command-boundary-legacy-v1.json')
const mapping = readJson('m5a-command-boundary-mapping-v1.json')
const pending = readJson('m5a-command-boundary-pending-v1.json')

if (active.stage !== 'M5A-10') throw new Error(`[m5a11-fixtures] expected active stage M5A-10, received ${active.stage}`)
const pendingEntries = mapping.entries.filter((entry) => entry.status === 'MIGRATION_PENDING')
if (pendingEntries.length !== 76 || pendingEntries.some((entry) => entry.planned_step !== 'M5A-11')) {
  throw new Error(`[m5a11-fixtures] expected 76 M5A-11 pending entries, received ${pendingEntries.length}`)
}

const legacyEntries = new Map([
  ...legacy.channels,
  ...legacy.direct_callsites,
  ...legacy.capability_callsites
].map((entry) => [entry.id, entry]))
const testOnlyFiles = new Set(['src/main/db/memory-adapter.ts', 'src/main/db/test-helpers.ts'])
const migrationEvidence = new Map([
  ['src/main/db/migration-backup.ts', ['src/main/db/__tests__/migration-backup.test.ts']],
  ['src/main/db/migrations.ts', ['src/main/db/__tests__/migrations.test.ts', 'src/main/db/__tests__/migration-startup.test.ts']],
  ['src/main/db/report-migration.ts', ['src/main/db/__tests__/report-migration.test.ts']],
  ['src/main/db/safety-rekey-migration.ts', ['src/main/db/__tests__/safety-rekey-migration.test.ts', 'src/main/db/__tests__/connection-m4-safety-rekey.test.ts']]
])

for (const entry of pendingEntries) {
  const legacyEntry = legacyEntries.get(entry.legacy_id)
  if (!legacyEntry) throw new Error(`[m5a11-fixtures] missing legacy entry ${entry.legacy_id}`)
  const isTestOnly = testOnlyFiles.has(legacyEntry.file)
  const evidence = isTestOnly
    ? ['scripts/__tests__/m5a-command-boundary-inventory.test.mjs', 'src/main/application/command/__tests__/preflight-no-side-effect.test.ts']
    : migrationEvidence.get(legacyEntry.file)
  if (!evidence) throw new Error(`[m5a11-fixtures] unclassified final exception ${legacyEntry.file}:${legacyEntry.symbol}`)

  entry.status = 'REGISTERED_EXCEPTION'
  entry.migrated_in_step = 'M5A-11'
  entry.exception_kind = isTestOnly ? 'TEST_ONLY' : 'MIGRATION_INTERNAL'
  entry.exception_reason = isTestOnly
    ? 'Test adapter/fixture write; production import graph is rejected by the inventory gate.'
    : 'Startup migration/backup write owned by the fixed SYSTEM migration phase, outside runtime command dispatch.'
  entry.actor_policy = isTestOnly ? 'TEST_ONLY' : 'SYSTEM_ONLY'
  entry.phase = isTestOnly ? 'TEST_FIXTURE' : 'STARTUP_UPGRADE'
  entry.transaction_owner = isTestOnly ? 'CALLING_TEST' : 'MIGRATION_STARTUP'
  entry.retry_policy = isTestOnly ? 'CALLER_DEFINED' : 'MANUAL_REVIEW'
  entry.test_evidence = [...new Set([...entry.test_evidence, ...evidence])]
}

active.stage = 'M5A-11'
if (!pending.step_order.includes('M5A-11')) pending.step_order.push('M5A-11')
pending.steps['M5A-11'] = []

writeJson('m5a-command-boundary-active-v1.json', active)
writeJson('m5a-command-boundary-mapping-v1.json', mapping)
writeJson('m5a-command-boundary-pending-v1.json', pending)

console.log(`[m5a11-fixtures] registered ${pendingEntries.length} scoped exceptions; MIGRATION_PENDING=0; stage=${active.stage}`)
