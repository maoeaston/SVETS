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

const byFingerprint = new Map(
  [...active.direct_callsites, ...active.capability_callsites]
    .map((entry) => [entry.fingerprint, entry])
)
const oldById = new Map(
  [...active.direct_callsites, ...active.capability_callsites]
    .map((entry) => [entry.id, entry])
)

const replacementRules = [
  rule('ACTIVE-DIRECT-001', 'src/main/application/runtime/internal-mutation-capability.ts', 'prepareInternalDirectory', 'FILE_MKDIRSYNC'),
  rule('ACTIVE-DIRECT-008', 'src/main/db/connection.ts', 'recoverActionLog', 'EVENT_WRITE'),
  rule('ACTIVE-DIRECT-258', 'src/main/utils/auth-session.ts', 'persistSessionRevocation', 'DB_RUN'),
  rule('ACTIVE-DIRECT-260', 'src/main/utils/auth-session.ts', 'persistAuthSessionHeartbeat', 'DB_RUN'),
  rule('ACTIVE-DIRECT-261', 'src/main/application/runtime/legacy-mutation-port.ts', 'writeEvent', 'EVENT_WRITE', null),
  rule('ACTIVE-CAP-001', 'src/main/db/connection.ts', 'initDatabase', 'LEGACY_RECOVERY_CALL'),
  rule('ACTIVE-CAP-005', 'src/main/domain/report-command-coordinator.ts', '<module>', 'REPORT_COORDINATOR_DECLARATION'),
  rule('ACTIVE-CAP-006', 'src/main/application/runtime/legacy-mutation-port.ts', 'recoverPending', 'LEGACY_RECOVERY_CALL'),
  rule('ACTIVE-CAP-019', 'src/main/ipc/handlers/job-skill-report.ts', 'createJobSkillReportAutomation', 'REPORT_COORDINATOR_INJECTION'),
  rule('ACTIVE-CAP-021', 'src/main/application/runtime/application-runtime.ts', 'createApplicationRuntime', 'REPORT_COORDINATOR_CONSTRUCTION'),
  rule('ACTIVE-CAP-022', 'src/main/ipc/handlers/reports.ts', 'confirmPlacementReview', 'REPORT_COMMAND_CALL'),
  rule('ACTIVE-CAP-023', 'src/main/ipc/handlers/reports.ts', 'lockReport', 'REPORT_COMMAND_CALL'),
  rule('ACTIVE-CAP-025', 'src/main/ipc/handlers/safety.ts', 'createSafetyReportAutomation', 'REPORT_COORDINATOR_INJECTION'),
  rule('ACTIVE-CAP-041', 'src/main/application/runtime/application-runtime.ts', '<module>', 'REPORT_COORDINATOR_IMPORT', null)
]

const registrationIds = new Map([
  ['registerAuthHandlers', 'ACTIVE-CAP-027'],
  ['registerStudentHandlers', 'ACTIVE-CAP-028'],
  ['registerStrategyHandlers', 'ACTIVE-CAP-029'],
  ['registerAssessmentHandlers', 'ACTIVE-CAP-030'],
  ['registerOperationScoringHandlers', 'ACTIVE-CAP-032'],
  ['registerAbilityScoringHandlers', 'ACTIVE-CAP-033'],
  ['registerJobSkillScoringHandlers', 'ACTIVE-CAP-034'],
  ['registerObservationHandlers', 'ACTIVE-CAP-035'],
  ['registerAssignmentHandlers', 'ACTIVE-CAP-036'],
  ['registerSafetyHandlers', 'ACTIVE-CAP-037'],
  ['registerFoundationHandlers', 'ACTIVE-CAP-038'],
  ['registerResultsHandlers', 'ACTIVE-CAP-039'],
  ['registerReportsHandlers', 'ACTIVE-CAP-040']
])

function rule(id, file, symbol, kind, legacyId = undefined) {
  return { id, file, symbol, kind, legacyId }
}

function metadataFor(id, explicitLegacyId) {
  const previous = oldById.get(id)
  return {
    id,
    legacy_id: explicitLegacyId === undefined ? previous?.legacy_id ?? null : explicitLegacyId
  }
}

function migrateCallsite(entry) {
  const unchanged = byFingerprint.get(entry.fingerprint)
  if (unchanged) return { ...entry, id: unchanged.id, legacy_id: unchanged.legacy_id }

  if (entry.kind === 'IPC_HANDLER_REGISTRATION') {
    const id = registrationIds.get(entry.callee)
    if (!id) throw new Error(`unmapped IPC registration: ${entry.callee}`)
    return { ...entry, ...metadataFor(id) }
  }

  const matches = replacementRules.filter((candidate) =>
    candidate.file === entry.file
    && candidate.symbol === entry.symbol
    && candidate.kind === entry.kind
  )
  if (matches.length !== 1) {
    throw new Error(`expected one replacement rule for ${entry.file}:${entry.symbol}:${entry.kind}; received ${matches.length}`)
  }
  const match = matches[0]
  return { ...entry, ...metadataFor(match.id, match.legacyId) }
}

const channelsByName = new Map(active.channels.map((entry) => [entry.channel, entry]))
const channels = scan.channels.map((entry) => {
  const previous = channelsByName.get(entry.channel)
  if (!previous) throw new Error(`unmapped IPC channel: ${entry.channel}`)
  return {
    ...entry,
    id: previous.id,
    mode: previous.mode,
    legacy_id: previous.legacy_id
  }
})
const directCallsites = scan.direct_callsites.map(migrateCallsite)
const capabilityCallsites = scan.capability_callsites.map(migrateCallsite)
const activeEntries = [...channels, ...directCallsites, ...capabilityCallsites]
const activeById = new Map(activeEntries.map((entry) => [entry.id, entry]))
if (activeById.size !== activeEntries.length) throw new Error('generated active IDs are not unique')

const oldClassifications = new Map(active.direct_files.map((entry) => [entry.path, entry.classification]))
const newClassifications = new Map([
  ['src/main/application/runtime/internal-mutation-capability.ts', 'PRODUCTION_INTERNAL_DIRECT'],
  ['src/main/application/runtime/legacy-mutation-port.ts', 'LOW_LEVEL_PORT']
])
const directFiles = scan.direct_files.map((path) => ({
  path,
  classification: oldClassifications.get(path) ?? newClassifications.get(path) ?? 'PRODUCTION_INTERNAL_DIRECT'
}))
const delegatingRoots = scan.delegating_roots.map((path) => ({
  path,
  capability_kinds: [...new Set(capabilityCallsites
    .filter((entry) => entry.file === path)
    .map((entry) => entry.kind))].sort()
}))

const generatedActive = {
  ...active,
  stage: 'M5A-3',
  source_digest: inventoryDigest(scan),
  channels,
  direct_callsites: directCallsites,
  direct_files: directFiles,
  capability_callsites: capabilityCallsites,
  delegating_roots: delegatingRoots
}

const retiredTargets = new Map([
  ['ACTIVE-DIRECT-094', 'ACTIVE-DIRECT-001'],
  ['ACTIVE-DIRECT-186', 'ACTIVE-DIRECT-001']
])
const m5a3Evidence = [
  'src/main/application/runtime/__tests__/application-runtime.test.ts',
  'src/main/ipc/handlers/__tests__/auth.test.ts',
  'src/main/domain/__tests__/report-coordinator.test.ts',
  'scripts/__tests__/m5a-command-boundary-inventory.test.mjs'
]

function describeActive(entry) {
  return {
    active_owner: entry.symbol,
    capability: 'mode' in entry ? `IPC_${entry.mode}` : entry.kind
  }
}

const migratedEntries = mapping.entries.map((entry) => {
  const activeId = retiredTargets.get(entry.active_id) ?? entry.active_id
  const target = activeById.get(activeId)
  if (!target) throw new Error(`mapping ${entry.id} has no generated active target ${activeId}`)
  const completed = entry.planned_step === 'M5A-3'
  return {
    ...entry,
    active_id: activeId,
    ...describeActive(target),
    status: completed ? 'MIGRATED' : entry.status,
    migrated_in_step: completed ? 'M5A-3' : entry.migrated_in_step,
    test_evidence: completed ? m5a3Evidence : entry.test_evidence
  }
})

for (const [id, activeId] of [
  ['MAPPING-NEW-M5A3-001', 'ACTIVE-DIRECT-261'],
  ['MAPPING-NEW-M5A3-002', 'ACTIVE-CAP-041']
]) {
  const target = activeById.get(activeId)
  if (!target) throw new Error(`missing new active target ${activeId}`)
  migratedEntries.push({
    id,
    legacy_id: null,
    origin: 'M5A_NEW_ACTIVE',
    active_id: activeId,
    ...describeActive(target),
    status: 'MIGRATED',
    planned_step: 'M5A-3',
    migrated_in_step: 'M5A-3',
    test_evidence: m5a3Evidence
  })
}

const generatedMapping = {
  ...mapping,
  entries: migratedEntries
}

writeFileSync(activePath, `${JSON.stringify(generatedActive, null, 2)}\n`)
writeFileSync(mappingPath, `${JSON.stringify(generatedMapping, null, 2)}\n`)
console.log(`[m5a-command-boundary] fixtures updated for M5A-3: active=${activeEntries.length}, mappings=${migratedEntries.length}, digest=${generatedActive.source_digest}`)
