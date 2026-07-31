#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadInventoryDocuments as loadM5aInventoryDocuments } from './lib/m5a-command-boundary-inventory.mjs'
import { scanBeforeM5bSourceDeltas, scanM5bCheckout } from './lib/m5b-runtime-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const priorSteps = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 12]
const priorDeltaPaths = priorSteps.map((step) => resolve(projectRoot, `scripts/fixtures/m5b-step${step}-source-delta-v1.json`))
const deltaPath = resolve(projectRoot, 'scripts/fixtures/m5b-step14-source-delta-v1.json')
const repairDeltaPath = resolve(projectRoot, 'scripts/fixtures/m5b-step15-source-delta-v1.json')

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function entriesAfter(entries, deltas, removedKey, addedKey) {
  const result = new Map(entries.map((entry) => [entry.fingerprint, entry]))
  for (const delta of deltas) {
    for (const entry of delta[removedKey] ?? []) result.delete(entry.fingerprint)
    for (const entry of delta[addedKey] ?? []) result.set(entry.fingerprint, entry)
  }
  return result
}

function diff(source, target) {
  const targetByFingerprint = new Map(target.map((entry) => [entry.fingerprint, entry]))
  const sourceByFingerprint = new Map(source.map((entry) => [entry.fingerprint, entry]))
  return {
    removed: source.filter((entry) => !targetByFingerprint.has(entry.fingerprint)),
    added: target.filter((entry) => !sourceByFingerprint.has(entry.fingerprint))
  }
}

function directTargetClass(entry) {
  if (entry.file === 'src/main/application/runtime/application-runtime.ts') return 'EVENT_BATCH_STARTUP_RECOVERY'
  if (entry.file === 'src/main/db/sqlite-adapter.ts') return 'PREPARE_ONLY_PLANNING_CLONE'
  if (entry.symbol === 'loadTargetSchema') return 'TARGET_SCHEMA_CUTOVER'
  if (entry.symbol === 'checkpointFull' || entry.symbol === 'vacuumInto') return 'M5B_ARCHIVAL_BACKUP'
  throw new Error(`[m5b-step14-fixture] unexpected direct addition ${entry.file}:${entry.symbol}`)
}

function capabilityDisposition(entry) {
  if (entry.kind === 'LEGACY_RECOVERY_CALL') return 'RETIRED_LEGACY_STARTUP_RECOVERY'
  if (entry.kind === 'REPORT_COORDINATOR_IMPORT' || entry.kind === 'REPORT_COORDINATOR_CONSTRUCTION') {
    return 'RETIRED_REPORT_COORDINATOR_COMPOSITION'
  }
  throw new Error(`[m5b-step14-fixture] unexpected capability removal ${entry.file}:${entry.kind}`)
}

function capabilityTargetClass(entry) {
  if (entry.kind === 'REPORT_COORDINATOR_IMPORT') return 'RETAINED_LEGACY_HANDLER_TEST_SEAM_IMPORT'
  throw new Error(`[m5b-step14-fixture] unexpected capability addition ${entry.file}:${entry.kind}`)
}

export function verifyM5bStep14SourceDelta() {
  const { active } = loadM5aInventoryDocuments(projectRoot)
  const deltas = priorDeltaPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  for (let index = 0; index < deltas.length; index += 1) {
    const expectedStep = `M5B-${priorSteps[index]}`
    const expectedSource = index === 0 ? active.source_digest : deltas[index - 1].target_digest
    if (deltas[index].step !== expectedStep || deltas[index].source_digest !== expectedSource) {
      throw new Error(`[m5b-step14-fixture] ${expectedStep} source chain is not accepted`)
    }
  }
  const sourceDirect = [...entriesAfter(active.direct_callsites, deltas, 'removed_source', 'added_target').values()]
  const sourceCapabilities = [...entriesAfter(active.capability_callsites, deltas, 'capability_removed_source', 'capability_added_target').values()]
  const sourceChannels = [...entriesAfter(active.channels, deltas, 'channel_removed_source', 'channel_added_target').values()]
  const sourceRoots = active.delegating_roots.map((entry) => entry.path)
  const scan = scanBeforeM5bSourceDeltas(
    scanM5bCheckout(projectRoot),
    [JSON.parse(readFileSync(repairDeltaPath, 'utf8'))]
  )
  const direct = diff(sourceDirect, scan.direct_callsites)
  const capabilities = diff(sourceCapabilities, scan.capability_callsites)
  const channels = diff(sourceChannels, scan.channels)
  const currentRoots = scan.delegating_roots
  const removedRoots = sourceRoots.filter((path) => !currentRoots.includes(path))
  const addedRoots = currentRoots.filter((path) => !sourceRoots.includes(path))
  const fixture = {
    schema_version: 'm5b-step-source-delta-v1',
    step: 'M5B-14',
    source_digest: deltas.at(-1).target_digest,
    target_digest: scan.digest,
    expected_counts: {
      channels: scan.channels.length,
      direct_callsites: scan.direct_callsites.length,
      direct_files: scan.direct_files.length,
      capability_callsites: scan.capability_callsites.length,
      delegating_roots: scan.delegating_roots.length
    },
    removed_source: direct.removed.map((entry) => ({ ...entry, disposition: 'RETIRED_LEGACY_STARTUP_RECOVERY' })),
    added_target: direct.added.map((entry) => ({ ...entry, target_class: directTargetClass(entry), planned_step: 'M5B-14' })),
    capability_removed_source: capabilities.removed.map((entry) => ({ ...entry, disposition: capabilityDisposition(entry) })),
    capability_added_target: capabilities.added.map((entry) => ({ ...entry, target_class: capabilityTargetClass(entry), planned_step: 'M5B-14' })),
    channel_removed_source: [],
    channel_added_target: channels.added.map((entry) => ({ ...entry, target_class: 'RUNTIME_HEALTH_READ', planned_step: 'M5B-14' })),
    delegating_root_removed_source: removedRoots.map((path) => ({ path, disposition: 'RETIRED_LEGACY_RUNTIME_COMPOSITION_ROOT' })),
    delegating_root_added_target: addedRoots.map((path) => ({ path, target_class: 'RETAINED_LEGACY_HANDLER_TEST_SEAM_ROOT', planned_step: 'M5B-14' }))
  }
  const exact = direct.removed.length === 3
    && direct.added.length === 5
    && capabilities.removed.length === 4
    && capabilities.added.length === 2
    && channels.removed.length === 0
    && channels.added.length === 1
    && removedRoots.length === 1
    && addedRoots.length === 2
  if (!exact) throw new Error('[m5b-step14-fixture] checkout does not match the reviewed M5B-14 source delta')
  if (existsSync(deltaPath)) {
    const frozen = JSON.parse(readFileSync(deltaPath, 'utf8'))
    if (!exactJson(frozen, fixture)) {
      if (process.argv.includes('--refresh-source-delta')) {
        writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
        return { status: 'refreshed', fixture }
      }
      throw new Error('[m5b-step14-fixture] frozen source delta differs from checkout')
    }
    return { status: 'verified', fixture }
  }
  writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  return { status: 'populated', fixture }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const delta = verifyM5bStep14SourceDelta()
  console.log(`[m5b-step14-fixture] source_delta=${delta.status}`)
  console.log(
    `[m5b-step14-fixture] digest=${delta.fixture.target_digest}, direct_removed=${delta.fixture.removed_source.length}, direct_added=${delta.fixture.added_target.length}, capability_removed=${delta.fixture.capability_removed_source.length}, capability_added=${delta.fixture.capability_added_target.length}, channels_added=${delta.fixture.channel_added_target.length}, roots_added=${delta.fixture.delegating_root_added_target.length}`
  )
}
