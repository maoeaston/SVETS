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

if (active.stage !== 'M5A-9') throw new Error(`expected M5A-9 active fixture, received ${active.stage}`)

const stepMappings = mapping.entries.filter((entry) => entry.planned_step === 'M5A-10')
if (stepMappings.length !== 39) {
  throw new Error(`expected 39 M5A-10 legacy mappings, received ${stepMappings.length}`)
}

const oldEntries = [...active.direct_callsites, ...active.capability_callsites]
const oldByFingerprint = new Map(oldEntries.map((entry) => [entry.fingerprint, entry]))
const oldChannels = new Map(active.channels.map((entry) => [entry.channel, entry]))
const oldById = new Map(oldEntries.map((entry) => [entry.id, entry]))

function migrationKey(entry) {
  return JSON.stringify({
    file: entry.file,
    symbol: entry.symbol,
    kind: entry.kind,
    callee: entry.callee,
    occurrence: entry.occurrence
  })
}

const oldByKey = new Map(oldEntries.map((entry) => [migrationKey(entry), entry]))
const usedActiveIds = new Set()

function retainChannel(entry) {
  const previous = oldChannels.get(entry.channel)
  if (!previous) throw new Error(`unmapped M5A-10 IPC channel: ${entry.channel}`)
  return { ...entry, id: previous.id, mode: previous.mode, legacy_id: previous.legacy_id }
}

function claim(entry, previous) {
  if (!previous) throw new Error(`missing M5A-10 relocation target for ${entry.file}:${entry.symbol}:${entry.kind}`)
  if (usedActiveIds.has(previous.id)) throw new Error(`M5A-10 active ID reused by scan entries: ${previous.id}`)
  usedActiveIds.add(previous.id)
  return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
}

function retainDirectCallsite(entry) {
  const unchanged = oldByFingerprint.get(entry.fingerprint)
  if (unchanged) return claim(entry, unchanged)

  if (entry.file === 'src/main/domain/report-export.ts') {
    const idByKind = {
      FILE_WRITEFILESYNC: 'ACTIVE-DIRECT-150',
      FILE_RENAMESYNC: 'ACTIVE-DIRECT-151',
      FILE_RMSYNC: 'ACTIVE-DIRECT-152'
    }
    const id = idByKind[entry.kind]
    if (id) return claim(entry, oldById.get(id))
  }
  if (
    entry.file === 'src/main/application/services/reports-service.ts'
    && entry.symbol === 'showReportSaveDialog'
    && entry.kind === 'FILE_MKDIRSYNC'
  ) {
    return claim(entry, oldById.get('ACTIVE-DIRECT-226'))
  }
  throw new Error(`unmapped M5A-10 direct callsite: ${entry.file}:${entry.symbol}:${entry.kind}`)
}

let nextCapabilityId = Math.max(
  ...active.capability_callsites.map((entry) => Number(entry.id.slice('ACTIVE-CAP-'.length)))
) + 1
const newActiveIds = new Set()

function newCapability(entry) {
  const id = `ACTIVE-CAP-${String(nextCapabilityId).padStart(3, '0')}`
  nextCapabilityId += 1
  newActiveIds.add(id)
  usedActiveIds.add(id)
  return { ...entry, id, legacy_id: null }
}

function retainCapabilityCallsite(entry) {
  const unchanged = oldByFingerprint.get(entry.fingerprint)
  if (unchanged) return claim(entry, unchanged)

  if (entry.file === 'src/main/domain/report-export.ts') {
    const previous = oldByKey.get(migrationKey(entry))
    if (previous) return claim(entry, previous)
  }
  if (entry.file === 'src/main/application/services/reports-service.ts') {
    if (entry.kind === 'REPORT_COORDINATOR_IMPORT') {
      return claim(entry, oldById.get('ACTIVE-CAP-020'))
    }
    if (entry.symbol === 'confirmPlacementReview' && entry.kind === 'REPORT_COMMAND_CALL') {
      return claim(entry, oldById.get('ACTIVE-CAP-022'))
    }
    if (entry.symbol === 'lockReport' && entry.kind === 'REPORT_COMMAND_CALL') {
      return claim(entry, oldById.get('ACTIVE-CAP-023'))
    }
    if (entry.symbol === 'createReportsApplicationService' && entry.kind === 'REPORT_COORDINATOR_INJECTION') {
      return newCapability(entry)
    }
  }
  throw new Error(`unmapped M5A-10 capability: ${entry.file}:${entry.symbol}:${entry.kind}`)
}

const channels = scan.channels.map(retainChannel)
const directCallsites = scan.direct_callsites.map(retainDirectCallsite)
const capabilityCallsites = scan.capability_callsites.map(retainCapabilityCallsite)
if (newActiveIds.size !== 1) {
  throw new Error(`expected one new M5A-10 active capability, received ${newActiveIds.size}`)
}

const activeEntries = [...channels, ...directCallsites, ...capabilityCallsites]
const activeById = new Map(activeEntries.map((entry) => [entry.id, entry]))
if (activeById.size !== activeEntries.length) throw new Error('generated M5A-10 active IDs are not unique')

const oldClassifications = new Map(active.direct_files.map((entry) => [entry.path, entry.classification]))
const directFiles = scan.direct_files.map((path) => ({
  path,
  classification: oldClassifications.get(path)
    ?? (path === 'src/main/application/services/reports-service.ts'
      ? oldClassifications.get('src/main/ipc/handlers/reports.ts')
      : undefined)
    ?? 'BUS_COMMAND_DIRECT'
}))
const delegatingRoots = scan.delegating_roots.map((path) => ({
  path,
  capability_kinds: [...new Set(capabilityCallsites
    .filter((entry) => entry.file === path)
    .map((entry) => entry.kind))].sort()
}))

const generatedActive = {
  ...active,
  stage: 'M5A-10',
  source_digest: inventoryDigest(scan),
  channels,
  direct_callsites: directCallsites,
  direct_files: directFiles,
  capability_callsites: capabilityCallsites,
  delegating_roots: delegatingRoots
}

const stepEvidence = [
  'src/main/application/services/__tests__/reports-command-bus.test.ts',
  'src/main/application/runtime/__tests__/application-runtime.test.ts',
  'src/main/ipc/handlers/__tests__/reports.test.ts',
  'src/main/ipc/handlers/__tests__/report-export.test.ts',
  'src/main/ipc/handlers/__tests__/report-integration.test.ts',
  'src/main/domain/__tests__/task-closure-service.test.ts',
  'src/main/domain/__tests__/report-coordinator.test.ts',
  'src/main/domain/__tests__/report-export.test.ts',
  'src/main/domain/__tests__/report-write-gate.test.ts',
  'src/main/domain/__tests__/report-generation.test.ts',
  'scripts/__tests__/m5a-command-boundary-inventory.test.mjs'
]

function describeActive(entry) {
  return {
    active_owner: entry.symbol,
    capability: 'mode' in entry ? `IPC_${entry.mode}` : entry.kind
  }
}

const retiredTargetRemap = new Map([
  ['ACTIVE-DIRECT-168', 'ACTIVE-CAP-012'],
  ['ACTIVE-DIRECT-169', 'ACTIVE-DIRECT-159']
])
const migratedEntries = mapping.entries.map((entry) => {
  const activeId = retiredTargetRemap.get(entry.active_id) ?? entry.active_id
  const target = activeById.get(activeId)
  if (!target) throw new Error(`mapping ${entry.id} has no M5A-10 active target ${activeId}`)
  const completed = entry.planned_step === 'M5A-10'
  return {
    ...entry,
    active_id: activeId,
    ...describeActive(target),
    status: completed ? 'MIGRATED' : entry.status,
    migrated_in_step: completed ? 'M5A-10' : entry.migrated_in_step,
    test_evidence: completed ? stepEvidence : entry.test_evidence
  }
})

for (const activeId of newActiveIds) {
  const target = activeById.get(activeId)
  migratedEntries.push({
    id: 'MAPPING-NEW-M5A10-001',
    legacy_id: null,
    origin: 'M5A_NEW_ACTIVE',
    active_id: activeId,
    ...describeActive(target),
    status: 'MIGRATED',
    planned_step: 'M5A-10',
    migrated_in_step: 'M5A-10',
    test_evidence: stepEvidence
  })
}

writeFileSync(activePath, `${JSON.stringify(generatedActive, null, 2)}\n`)
writeFileSync(mappingPath, `${JSON.stringify({ ...mapping, entries: migratedEntries }, null, 2)}\n`)
console.log(
  `[m5a-command-boundary] fixtures updated for M5A-10: active=${activeEntries.length}, mappings=${migratedEntries.length}, new=${newActiveIds.size}, digest=${generatedActive.source_digest}`
)
