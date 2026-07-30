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

if (active.stage !== 'M5A-5') throw new Error(`expected M5A-5 active fixture, received ${active.stage}`)

const stepMappings = mapping.entries.filter((entry) => entry.planned_step === 'M5A-6')
const stepActiveIds = new Set(stepMappings.map((entry) => entry.active_id))
if (stepMappings.length !== 24 || stepActiveIds.size !== 24) {
  throw new Error(`expected 24 distinct M5A-6 mappings, received ${stepMappings.length}/${stepActiveIds.size}`)
}

const oldEntries = [...active.direct_callsites, ...active.capability_callsites]
const oldByFingerprint = new Map(oldEntries.map((entry) => [entry.fingerprint, entry]))
const oldChannels = new Map(active.channels.map((entry) => [entry.channel, entry]))
const oldDirectByMigrationKey = new Map(
  active.direct_callsites
    .filter((entry) => stepActiveIds.has(entry.id) && entry.kind !== 'EVENT_WRITE')
    .map((entry) => [migrationKey(entry), entry])
)
const oldEventByOwner = new Map(
  active.direct_callsites
    .filter((entry) => stepActiveIds.has(entry.id) && entry.kind === 'EVENT_WRITE')
    .map((entry) => [ownerKey(entry), entry])
)

function migrationKey(entry) {
  return JSON.stringify({
    symbol: entry.symbol,
    kind: entry.kind,
    callee: entry.callee,
    detail: entry.detail,
    occurrence: entry.occurrence
  })
}

function ownerKey(entry) {
  return JSON.stringify({ symbol: entry.symbol, occurrence: entry.occurrence })
}

function retainChannel(entry) {
  const previous = oldChannels.get(entry.channel)
  if (!previous) throw new Error(`unmapped M5A-6 IPC channel: ${entry.channel}`)
  return { ...entry, id: previous.id, mode: previous.mode, legacy_id: previous.legacy_id }
}

const migratedIds = new Set()
function retainDirectCallsite(entry) {
  const unchanged = oldByFingerprint.get(entry.fingerprint)
  if (unchanged) {
    if (stepActiveIds.has(unchanged.id)) migratedIds.add(unchanged.id)
    return { ...entry, id: unchanged.id, legacy_id: unchanged.legacy_id }
  }

  const previous = oldDirectByMigrationKey.get(migrationKey(entry))
  if (!previous) throw new Error(`unmapped M5A-6 direct callsite: ${entry.file}:${entry.symbol}:${entry.kind}`)
  if (!entry.file.startsWith('src/main/application/services/')) {
    throw new Error(`M5A-6 direct callsite did not move to application service: ${entry.file}`)
  }
  migratedIds.add(previous.id)
  return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
}

function retainCapabilityCallsite(entry) {
  const unchanged = oldByFingerprint.get(entry.fingerprint)
  if (unchanged) return { ...entry, id: unchanged.id, legacy_id: unchanged.legacy_id }

  if (entry.kind !== 'LEGACY_EVENT_PORT_CALL' || !entry.file.startsWith('src/main/application/services/')) {
    throw new Error(`unmapped M5A-6 capability: ${entry.file}:${entry.symbol}:${entry.kind}`)
  }
  const previous = oldEventByOwner.get(ownerKey(entry))
  if (!previous) throw new Error(`unmapped M5A-6 event-port owner: ${entry.symbol}`)
  migratedIds.add(previous.id)
  return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
}

const channels = scan.channels.map(retainChannel)
const directCallsites = scan.direct_callsites.map(retainDirectCallsite)
const capabilityCallsites = scan.capability_callsites.map(retainCapabilityCallsite)
if (migratedIds.size !== stepActiveIds.size || [...stepActiveIds].some((id) => !migratedIds.has(id))) {
  throw new Error(`M5A-6 migrated active IDs mismatch: ${JSON.stringify([...migratedIds].sort())}`)
}

const activeEntries = [...channels, ...directCallsites, ...capabilityCallsites]
const activeById = new Map(activeEntries.map((entry) => [entry.id, entry]))
if (activeById.size !== activeEntries.length) throw new Error('generated M5A-6 active IDs are not unique')

const oldClassifications = new Map(active.direct_files.map((entry) => [entry.path, entry.classification]))
const movedClassification = new Map([
  [
    'src/main/application/services/training-service.ts',
    oldClassifications.get('src/main/ipc/handlers/training.ts')
  ]
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
  stage: 'M5A-6',
  source_digest: inventoryDigest(scan),
  channels,
  direct_callsites: directCallsites,
  direct_files: directFiles,
  capability_callsites: capabilityCallsites,
  delegating_roots: delegatingRoots
}

const stepEvidence = [
  'src/main/application/services/__tests__/training-command-bus.test.ts',
  'src/main/ipc/handlers/__tests__/training-create.test.ts',
  'src/main/ipc/handlers/__tests__/training-steps.test.ts',
  'src/main/ipc/handlers/__tests__/training-complete.test.ts',
  'src/main/ipc/handlers/__tests__/training-redline.test.ts',
  'src/main/domain/__tests__/training-reducer.test.ts',
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
  if (!target) throw new Error(`mapping ${entry.id} has no M5A-6 active target ${entry.active_id}`)
  const completed = entry.planned_step === 'M5A-6'
  return {
    ...entry,
    ...describeActive(target),
    status: completed ? 'MIGRATED' : entry.status,
    migrated_in_step: completed ? 'M5A-6' : entry.migrated_in_step,
    test_evidence: completed ? stepEvidence : entry.test_evidence
  }
})

writeFileSync(activePath, `${JSON.stringify(generatedActive, null, 2)}\n`)
writeFileSync(mappingPath, `${JSON.stringify({ ...mapping, entries: migratedEntries }, null, 2)}\n`)
console.log(
  `[m5a-command-boundary] fixtures updated for M5A-6: active=${activeEntries.length}, mappings=${migratedEntries.length}, migrated=${migratedIds.size}, digest=${generatedActive.source_digest}`
)
