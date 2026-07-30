#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { inventoryDigest, scanCheckout } from './lib/m5a-command-boundary-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = join(projectRoot, 'scripts', 'fixtures')

function readJson(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'))
}

function writeJson(name, value) {
  writeFileSync(join(fixtureRoot, name), `${JSON.stringify(value, null, 2)}\n`)
}

function mergeByFingerprint(current, previous, label) {
  const previousByFingerprint = new Map(previous.map((entry) => [entry.fingerprint, entry]))
  return current.map((entry) => {
    const prior = previousByFingerprint.get(entry.fingerprint)
    if (!prior) throw new Error(`[m5a11-publication] unclassified ${label}: ${entry.file}:${entry.symbol}:${entry.kind}`)
    return { ...entry, id: prior.id, legacy_id: prior.legacy_id }
  })
}

const active = readJson('m5a-command-boundary-active-v1.json')
const legacy = readJson('m5a-command-boundary-legacy-v1.json')
const mapping = readJson('m5a-command-boundary-mapping-v1.json')
if (active.stage !== 'M5A-11') throw new Error(`[m5a11-publication] expected M5A-11, received ${active.stage}`)
if (mapping.entries.some((entry) => entry.status === 'MIGRATION_PENDING')) {
  throw new Error('[m5a11-publication] target fixture still contains MIGRATION_PENDING')
}

const scan = scanCheckout(projectRoot)
const oldDirectByFingerprint = new Map(active.direct_callsites.map((entry) => [entry.fingerprint, entry]))
const link = scan.direct_callsites.find((entry) =>
  entry.file === 'src/main/domain/report-export.ts'
  && entry.symbol === 'renameOwnedTemp'
  && entry.kind === 'FILE_LINKSYNC'
)
const unlink = scan.direct_callsites.find((entry) =>
  entry.file === 'src/main/domain/report-export.ts'
  && entry.symbol === 'renameOwnedTemp'
  && entry.kind === 'FILE_UNLINKSYNC'
)
if (!link || !unlink) throw new Error('[m5a11-publication] no-clobber publication callsites are missing')

const legacyChannelByName = new Map(legacy.channels.map((entry) => [entry.channel, entry]))
active.channels = mergeByFingerprint(scan.channels, active.channels, 'channel').map((entry) => ({
  ...entry,
  mode: legacyChannelByName.get(entry.channel)?.mode
}))
active.direct_callsites = scan.direct_callsites.map((entry) => {
  const prior = oldDirectByFingerprint.get(entry.fingerprint)
  if (prior) return { ...entry, id: prior.id, legacy_id: prior.legacy_id }
  if (entry.fingerprint === link.fingerprint) {
    return { ...entry, id: 'ACTIVE-DIRECT-151', legacy_id: 'LEGACY-DIRECT-151' }
  }
  if (entry.fingerprint === unlink.fingerprint) {
    return { ...entry, id: 'ACTIVE-DIRECT-262', legacy_id: null }
  }
  throw new Error(`[m5a11-publication] unclassified direct callsite: ${entry.file}:${entry.symbol}:${entry.kind}`)
})
active.capability_callsites = mergeByFingerprint(scan.capability_callsites, active.capability_callsites, 'capability')
for (const entry of active.capability_callsites) {
  if (entry.id === 'ACTIVE-CAP-NaN') entry.id = 'ACTIVE-CAP-256'
}

const directClassifications = new Map(active.direct_files.map((entry) => [entry.path, entry.classification]))
active.direct_files = scan.direct_files.map((path) => ({
  path,
  classification: directClassifications.get(path) ?? 'PRODUCTION_INTERNAL_DIRECT'
}))
const rootClassifications = new Map(active.delegating_roots.map((entry) => [entry.path, entry.classification]))
active.delegating_roots = scan.delegating_roots.map((path) => ({
  path,
  classification: rootClassifications.get(path) ?? 'PRODUCTION_INTERNAL_DELEGATION'
}))
active.source_digest = inventoryDigest(scan)

const renamedMapping = mapping.entries.find((entry) => entry.active_id === 'ACTIVE-DIRECT-151')
if (!renamedMapping) throw new Error('[m5a11-publication] legacy rename mapping is missing')
renamedMapping.capability = 'FILE_LINKSYNC'
renamedMapping.test_evidence = [...new Set([
  ...renamedMapping.test_evidence,
  'src/main/domain/__tests__/report-export.test.ts'
])]

const malformedCapabilityMapping = mapping.entries.find((entry) => entry.active_id === 'ACTIVE-CAP-NaN')
if (malformedCapabilityMapping) malformedCapabilityMapping.active_id = 'ACTIVE-CAP-256'
if (!mapping.entries.some((entry) => entry.active_id === 'ACTIVE-CAP-256')) {
  throw new Error('[m5a11-publication] corrected capability ID fixture is missing')
}

if (!mapping.entries.some((entry) => entry.id === 'MAPPING-NEW-M5A11-001')) {
  mapping.entries.push({
    id: 'MAPPING-NEW-M5A11-001',
    legacy_id: null,
    origin: 'M5A_NEW_ACTIVE',
    active_id: 'ACTIVE-DIRECT-262',
    active_owner: 'renameOwnedTemp',
    capability: 'FILE_UNLINKSYNC',
    status: 'MIGRATED',
    planned_step: 'M5A-11',
    migrated_in_step: 'M5A-11',
    test_evidence: [
      'src/main/domain/__tests__/report-export.test.ts',
      'scripts/__tests__/m5a-command-boundary-inventory.test.mjs'
    ]
  })
}

writeJson('m5a-command-boundary-active-v1.json', active)
writeJson('m5a-command-boundary-mapping-v1.json', mapping)

console.log(`[m5a11-publication] no-clobber publication registered; direct=${active.direct_callsites.length}; digest=${active.source_digest}`)
