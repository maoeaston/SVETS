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

if (active.stage !== 'M5A-3') throw new Error(`expected M5A-3 active fixture, received ${active.stage}`)

const oldEntries = [...active.direct_callsites, ...active.capability_callsites]
const oldByFingerprint = new Map(oldEntries.map((entry) => [entry.fingerprint, entry]))
const oldChannels = new Map(active.channels.map((entry) => [entry.channel, entry]))

const channels = scan.channels.map((entry) => {
  const previous = oldChannels.get(entry.channel)
  if (!previous) throw new Error(`unmapped central IPC channel: ${entry.channel}`)
  return {
    ...entry,
    id: previous.id,
    mode: previous.mode,
    legacy_id: previous.legacy_id
  }
})

const centralRegistration = scan.capability_callsites.filter((entry) =>
  entry.kind === 'IPC_HANDLER_REGISTRATION'
  && entry.file === 'src/main/ipc/index.ts'
  && entry.callee === 'registerCentralIpcHandlers'
)
if (centralRegistration.length !== 1) {
  throw new Error(`expected one central registration capability, received ${centralRegistration.length}`)
}

function retainCallsite(entry) {
  const previous = oldByFingerprint.get(entry.fingerprint)
  if (!previous) throw new Error(`unmapped M5A-4 callsite: ${entry.file}:${entry.symbol}:${entry.kind}`)
  return { ...entry, id: previous.id, legacy_id: previous.legacy_id }
}

const directCallsites = scan.direct_callsites.map(retainCallsite)
const capabilityCallsites = scan.capability_callsites.map((entry) => {
  if (entry.fingerprint === centralRegistration[0].fingerprint) {
    return { ...entry, id: 'ACTIVE-CAP-027', legacy_id: 'LEGACY-CAP-027' }
  }
  return retainCallsite(entry)
})

const activeEntries = [...channels, ...directCallsites, ...capabilityCallsites]
const activeById = new Map(activeEntries.map((entry) => [entry.id, entry]))
if (activeById.size !== activeEntries.length) throw new Error('generated M5A-4 active IDs are not unique')

const oldClassifications = new Map(active.direct_files.map((entry) => [entry.path, entry.classification]))
const directFiles = scan.direct_files.map((path) => ({
  path,
  classification: oldClassifications.get(path) ?? 'PRODUCTION_INTERNAL_DIRECT'
}))
const delegatingRoots = scan.delegating_roots.map((path) => ({
  path,
  capability_kinds: [...new Set(capabilityCallsites
    .filter((entry) => entry.file === path)
    .map((entry) => entry.kind))].sort()
}))

const generatedActive = {
  ...active,
  stage: 'M5A-4',
  source_digest: inventoryDigest(scan),
  channels,
  direct_callsites: directCallsites,
  direct_files: directFiles,
  capability_callsites: capabilityCallsites,
  delegating_roots: delegatingRoots
}

const m5a4Evidence = [
  'src/main/ipc/__tests__/handler-registry.test.ts',
  'src/main/application/command/__tests__/preflight-no-side-effect.test.ts',
  'scripts/__tests__/m5a-command-boundary-inventory.test.mjs'
]
const retiredRegistrationIds = new Set(
  Array.from({ length: 14 }, (_, index) => `ACTIVE-CAP-${String(index + 27).padStart(3, '0')}`)
)

function describeActive(entry) {
  return {
    active_owner: entry.symbol,
    capability: 'mode' in entry ? `IPC_${entry.mode}` : entry.kind
  }
}

const migratedEntries = mapping.entries.map((entry) => {
  let activeId = entry.active_id
  if (entry.planned_step === 'M5A-4' && retiredRegistrationIds.has(activeId)) {
    activeId = 'ACTIVE-CAP-027'
  }
  const target = activeById.get(activeId)
  if (!target) throw new Error(`mapping ${entry.id} has no M5A-4 active target ${activeId}`)
  const completed = entry.planned_step === 'M5A-4'
  return {
    ...entry,
    active_id: activeId,
    ...describeActive(target),
    status: completed ? 'MIGRATED' : entry.status,
    migrated_in_step: completed ? 'M5A-4' : entry.migrated_in_step,
    test_evidence: completed ? m5a4Evidence : entry.test_evidence
  }
})

const generatedMapping = { ...mapping, entries: migratedEntries }

writeFileSync(activePath, `${JSON.stringify(generatedActive, null, 2)}\n`)
writeFileSync(mappingPath, `${JSON.stringify(generatedMapping, null, 2)}\n`)
console.log(
  `[m5a-command-boundary] fixtures updated for M5A-4: active=${activeEntries.length}, mappings=${migratedEntries.length}, digest=${generatedActive.source_digest}`
)
