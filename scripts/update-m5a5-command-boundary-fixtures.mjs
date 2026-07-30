#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inventoryDigest,
  scanCheckout
} from './lib/m5a-command-boundary-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = join(projectRoot, 'scripts', 'fixtures')
const activePath = join(fixtureRoot, 'm5a-command-boundary-active-v1.json')
const mappingPath = join(fixtureRoot, 'm5a-command-boundary-mapping-v1.json')
const active = JSON.parse(readFileSync(activePath, 'utf8'))
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'))
const scan = scanCheckout(projectRoot)

if (active.stage !== 'M5A-4') throw new Error(`expected M5A-4 active fixture, received ${active.stage}`)

const m5a5Mappings = mapping.entries.filter((entry) => entry.planned_step === 'M5A-5')
const m5a5ActiveIds = new Set(m5a5Mappings.map((entry) => entry.active_id))
if (m5a5Mappings.length !== 18 || m5a5ActiveIds.size !== 18) {
  throw new Error(`expected 18 distinct M5A-5 mappings, received ${m5a5Mappings.length}/${m5a5ActiveIds.size}`)
}

const oldEntries = [...active.direct_callsites, ...active.capability_callsites]
const oldByFingerprint = new Map(oldEntries.map((entry) => [entry.fingerprint, entry]))
const oldByMigrationKey = new Map(
  active.direct_callsites
    .filter((entry) => m5a5ActiveIds.has(entry.id))
    .map((entry) => [migrationKey(entry), entry])
)
const oldChannels = new Map(active.channels.map((entry) => [entry.channel, entry]))

function migrationKey(entry) {
  return JSON.stringify({
    symbol: entry.symbol,
    kind: entry.kind,
    callee: entry.callee,
    detail: entry.detail,
    occurrence: entry.occurrence
  })
}

function retainChannel(entry) {
  const previous = oldChannels.get(entry.channel)
  if (!previous) throw new Error(`unmapped M5A-5 IPC channel: ${entry.channel}`)
  return { ...entry, id: previous.id, mode: previous.mode, legacy_id: previous.legacy_id }
}

const migratedIds = new Set()
function retainDirectCallsite(entry) {
  const unchanged = oldByFingerprint.get(entry.fingerprint)
  if (unchanged) return { ...entry, id: unchanged.id, legacy_id: unchanged.legacy_id }

  const previous = oldByMigrationKey.get(migrationKey(entry))
  if (!previous) throw new Error(`unmapped M5A-5 direct callsite: ${entry.file}:${entry.symbol}:${entry.kind}`)
  if (!entry.file.startsWith('src/main/application/services/')) {
    throw new Error(`M5A-5 direct callsite did not move to application service: ${entry.file}`)
  }
  migratedIds.add(previous.id)
  return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
}

function retainCapabilityCallsite(entry) {
  const previous = oldByFingerprint.get(entry.fingerprint)
  if (!previous) throw new Error(`unmapped M5A-5 capability: ${entry.file}:${entry.symbol}:${entry.kind}`)
  return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
}

const channels = scan.channels.map(retainChannel)
const directCallsites = scan.direct_callsites.map(retainDirectCallsite)
const capabilityCallsites = scan.capability_callsites.map(retainCapabilityCallsite)
if (migratedIds.size !== m5a5ActiveIds.size || [...m5a5ActiveIds].some((id) => !migratedIds.has(id))) {
  throw new Error(`M5A-5 migrated active IDs mismatch: ${JSON.stringify([...migratedIds].sort())}`)
}

const activeEntries = [...channels, ...directCallsites, ...capabilityCallsites]
const activeById = new Map(activeEntries.map((entry) => [entry.id, entry]))
if (activeById.size !== activeEntries.length) throw new Error('generated M5A-5 active IDs are not unique')

const oldClassifications = new Map(active.direct_files.map((entry) => [entry.path, entry.classification]))
const movedClassification = new Map([
  ['src/main/application/services/auth-service.ts', oldClassifications.get('src/main/ipc/handlers/auth.ts')],
  ['src/main/application/services/student-service.ts', oldClassifications.get('src/main/ipc/handlers/student.ts')],
  ['src/main/application/services/strategy-service.ts', oldClassifications.get('src/main/ipc/handlers/strategy.ts')]
])
const directFiles = scan.direct_files.map((path) => ({
  path,
  classification: oldClassifications.get(path) ?? movedClassification.get(path) ?? 'BUS_COMMAND_DIRECT'
}))
const delegatingRoots = scan.delegating_roots.map((path) => ({
  path,
  capability_kinds: [...new Set(capabilityCallsites
    .filter((entry) => entry.file === path)
    .map((entry) => entry.kind))].sort()
}))

const generatedActive = {
  ...active,
  stage: 'M5A-5',
  source_digest: inventoryDigest(scan),
  channels,
  direct_callsites: directCallsites,
  direct_files: directFiles,
  capability_callsites: capabilityCallsites,
  delegating_roots: delegatingRoots
}

const m5a5Evidence = [
  'src/main/application/services/__tests__/account-command-bus.test.ts',
  'src/main/ipc/handlers/__tests__/auth.test.ts',
  'src/main/ipc/handlers/__tests__/student-create.test.ts',
  'src/main/ipc/handlers/__tests__/student-mutate.test.ts',
  'src/main/ipc/handlers/__tests__/strategy-create-version.test.ts',
  'src/main/ipc/handlers/__tests__/strategy-update.test.ts',
  'src/main/ipc/handlers/__tests__/strategy-set-active.test.ts',
  'scripts/__tests__/m5a-command-boundary-inventory.test.mjs'
]

function describeActive(entry) {
  return {
    active_owner: entry.symbol,
    capability: 'mode' in entry ? `IPC_${entry.mode}` : entry.kind
  }
}

const migratedEntries = mapping.entries.map((entry) => {
  const target = activeById.get(entry.active_id)
  if (!target) throw new Error(`mapping ${entry.id} has no M5A-5 active target ${entry.active_id}`)
  const completed = entry.planned_step === 'M5A-5'
  return {
    ...entry,
    ...describeActive(target),
    status: completed ? 'MIGRATED' : entry.status,
    migrated_in_step: completed ? 'M5A-5' : entry.migrated_in_step,
    test_evidence: completed ? m5a5Evidence : entry.test_evidence
  }
})

writeFileSync(activePath, `${JSON.stringify(generatedActive, null, 2)}\n`)
writeFileSync(mappingPath, `${JSON.stringify({ ...mapping, entries: migratedEntries }, null, 2)}\n`)
console.log(
  `[m5a-command-boundary] fixtures updated for M5A-5: active=${activeEntries.length}, mappings=${migratedEntries.length}, migrated=${migratedIds.size}, digest=${generatedActive.source_digest}`
)
