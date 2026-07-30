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

if (active.stage !== 'M5A-8') throw new Error(`expected M5A-8 active fixture, received ${active.stage}`)

const stepMappings = mapping.entries.filter((entry) => entry.planned_step === 'M5A-9')
const stepActiveIds = new Set(stepMappings.map((entry) => entry.active_id))
if (stepMappings.length !== 34 || stepActiveIds.size !== 34) {
  throw new Error(`expected 34 distinct M5A-9 mappings, received ${stepMappings.length}/${stepActiveIds.size}`)
}

const oldEntries = [...active.direct_callsites, ...active.capability_callsites]
const oldByFingerprint = new Map(oldEntries.map((entry) => [entry.fingerprint, entry]))
const oldChannels = new Map(active.channels.map((entry) => [entry.channel, entry]))

function migrationKey(entry, file) {
  return JSON.stringify({
    file,
    symbol: entry.symbol,
    kind: entry.kind,
    callee: entry.callee,
    detail: entry.detail,
    occurrence: entry.occurrence
  })
}

const oldDirectByKey = new Map(
  active.direct_callsites.map((entry) => [migrationKey(entry, entry.file), entry])
)
const oldCapabilitiesByKey = new Map(
  active.capability_callsites.map((entry) => [migrationKey(entry, entry.file), entry])
)
const oldEventByOwner = new Map()
for (const entry of active.direct_callsites.filter(
  (candidate) => stepActiveIds.has(candidate.id) && candidate.kind === 'EVENT_WRITE'
)) {
  const candidates = oldEventByOwner.get(entry.symbol) ?? []
  candidates.push(entry)
  oldEventByOwner.set(entry.symbol, candidates)
}

function retainChannel(entry) {
  const previous = oldChannels.get(entry.channel)
  if (!previous) throw new Error(`unmapped M5A-9 IPC channel: ${entry.channel}`)
  return { ...entry, id: previous.id, mode: previous.mode, legacy_id: previous.legacy_id }
}

const relocatedIds = new Set()

function retainDirectCallsite(entry) {
  const unchanged = oldByFingerprint.get(entry.fingerprint)
  if (unchanged) return { ...entry, id: unchanged.id, legacy_id: unchanged.legacy_id }

  if (entry.file === 'src/main/application/services/safety-service.ts') {
    const previous = oldDirectByKey.get(migrationKey(entry, 'src/main/ipc/handlers/safety.ts'))
    if (previous && stepActiveIds.has(previous.id)) {
      relocatedIds.add(previous.id)
      return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
    }
  }
  throw new Error(`unmapped M5A-9 direct callsite: ${entry.file}:${entry.symbol}:${entry.kind}`)
}

const eventOffsets = new Map()

function retainCapabilityCallsite(entry) {
  const unchanged = oldByFingerprint.get(entry.fingerprint)
  if (unchanged) return { ...entry, id: unchanged.id, legacy_id: unchanged.legacy_id }

  if (
    entry.kind === 'LEGACY_EVENT_PORT_CALL'
    && (
      entry.file === 'src/main/application/services/assignment-service.ts'
      || entry.file === 'src/main/application/services/safety-service.ts'
    )
  ) {
    const candidates = oldEventByOwner.get(entry.symbol) ?? []
    const offset = eventOffsets.get(entry.symbol) ?? 0
    const previous = candidates[offset]
    if (!previous) throw new Error(`unmapped M5A-9 event-port owner: ${entry.symbol}`)
    eventOffsets.set(entry.symbol, offset + 1)
    relocatedIds.add(previous.id)
    return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
  }

  if (entry.file === 'src/main/application/services/safety-service.ts') {
    const previous = oldCapabilitiesByKey.get(migrationKey(entry, 'src/main/ipc/handlers/safety.ts'))
    if (previous && stepActiveIds.has(previous.id)) {
      relocatedIds.add(previous.id)
      return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
    }
  }
  throw new Error(`unmapped M5A-9 capability: ${entry.file}:${entry.symbol}:${entry.kind}`)
}

const channels = scan.channels.map(retainChannel)
const directCallsites = scan.direct_callsites.map(retainDirectCallsite)
const capabilityCallsites = scan.capability_callsites.map(retainCapabilityCallsite)
if (relocatedIds.size !== 17) {
  throw new Error(`expected 17 relocated M5A-9 active IDs, received ${relocatedIds.size}`)
}

const activeEntries = [...channels, ...directCallsites, ...capabilityCallsites]
const activeById = new Map(activeEntries.map((entry) => [entry.id, entry]))
if (activeById.size !== activeEntries.length) {
  const counts = new Map()
  for (const entry of activeEntries) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1)
  throw new Error(`generated M5A-9 active IDs are not unique: ${JSON.stringify(duplicates)}`)
}
for (const activeId of stepActiveIds) {
  if (!activeById.has(activeId)) throw new Error(`M5A-9 active target disappeared: ${activeId}`)
}

const oldClassifications = new Map(active.direct_files.map((entry) => [entry.path, entry.classification]))
const movedClassification = new Map([
  [
    'src/main/application/services/safety-service.ts',
    oldClassifications.get('src/main/ipc/handlers/safety.ts')
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
  stage: 'M5A-9',
  source_digest: inventoryDigest(scan),
  channels,
  direct_callsites: directCallsites,
  direct_files: directFiles,
  capability_callsites: capabilityCallsites,
  delegating_roots: delegatingRoots
}

const stepEvidence = [
  'src/main/application/services/__tests__/assignment-safety-command-bus.test.ts',
  'src/main/ipc/handlers/__tests__/assignment.test.ts',
  'src/main/domain/__tests__/local-runtime-context.test.ts',
  'src/main/ipc/handlers/__tests__/safety.test.ts',
  'src/main/ipc/handlers/__tests__/assessment-redline.test.ts',
  'src/main/ipc/handlers/__tests__/training-redline.test.ts',
  'src/main/ipc/handlers/__tests__/report-integration.test.ts',
  'src/main/db/__tests__/schema-m4-safety-rekey.test.ts',
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
  if (!target) throw new Error(`mapping ${entry.id} has no M5A-9 active target ${entry.active_id}`)
  const completed = entry.planned_step === 'M5A-9'
  return {
    ...entry,
    ...describeActive(target),
    status: completed ? 'MIGRATED' : entry.status,
    migrated_in_step: completed ? 'M5A-9' : entry.migrated_in_step,
    test_evidence: completed ? stepEvidence : entry.test_evidence
  }
})

writeFileSync(activePath, `${JSON.stringify(generatedActive, null, 2)}\n`)
writeFileSync(mappingPath, `${JSON.stringify({ ...mapping, entries: migratedEntries }, null, 2)}\n`)
console.log(
  `[m5a-command-boundary] fixtures updated for M5A-9: active=${activeEntries.length}, mappings=${migratedEntries.length}, relocated=${relocatedIds.size}, digest=${generatedActive.source_digest}`
)
