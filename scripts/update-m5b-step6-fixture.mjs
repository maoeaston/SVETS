#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadInventoryDocuments as loadM5aInventoryDocuments } from './lib/m5a-command-boundary-inventory.mjs'
import { scanM5bCheckout } from './lib/m5b-runtime-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const deltaPaths = [2, 3, 4, 5].map((step) => resolve(
  projectRoot,
  `scripts/fixtures/m5b-step${step}-source-delta-v1.json`
))
const deltaPath = resolve(projectRoot, 'scripts/fixtures/m5b-step6-source-delta-v1.json')

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sourceFingerprints(active, deltas) {
  const fingerprints = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  for (const delta of deltas) {
    for (const entry of delta.removed_source) fingerprints.delete(entry.fingerprint)
    for (const entry of delta.added_target) fingerprints.add(entry.fingerprint)
  }
  return fingerprints
}

function capabilityFingerprints(active, deltas) {
  const fingerprints = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  for (const delta of deltas) {
    for (const entry of delta.capability_removed_source ?? []) fingerprints.delete(entry.fingerprint)
    for (const entry of delta.capability_added_target ?? []) fingerprints.add(entry.fingerprint)
  }
  return fingerprints
}

function targetClass(entry) {
  if (entry.file === 'src/main/domain/projectors/task-closure-projector.ts') {
    return 'REPORT_CLOSURE_PROJECTOR_INTERNAL'
  }
  throw new Error(`[m5b-step6-fixture] unclassified added callsite ${entry.file}:${entry.symbol}`)
}

function updateSourceDelta() {
  const { active } = loadM5aInventoryDocuments(projectRoot)
  const deltas = deltaPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  for (let index = 0; index < deltas.length; index += 1) {
    const expectedStep = `M5B-${index + 2}`
    const expectedSource = index === 0 ? active.source_digest : deltas[index - 1].target_digest
    if (deltas[index].step !== expectedStep || deltas[index].source_digest !== expectedSource) {
      throw new Error(`[m5b-step6-fixture] ${expectedStep} source chain is not accepted`)
    }
  }
  const scan = scanM5bCheckout(projectRoot)
  const source = sourceFingerprints(active, deltas)
  const target = new Set(scan.direct_callsites.map((entry) => entry.fingerprint))
  const removed = [...source].filter((fingerprint) => !target.has(fingerprint))
  const added = scan.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  const sourceCapabilities = capabilityFingerprints(active, deltas)
  const targetCapabilities = new Set(scan.capability_callsites.map((entry) => entry.fingerprint))
  const removedCapabilities = [...sourceCapabilities].filter((fingerprint) => !targetCapabilities.has(fingerprint))
  const addedCapabilities = scan.capability_callsites.filter((entry) => !sourceCapabilities.has(entry.fingerprint))
  const exact = removed.length === 0
    && added.length === 4
    && removedCapabilities.length === 0
    && addedCapabilities.length === 0
    && added.every((entry) => entry.file === 'src/main/domain/projectors/task-closure-projector.ts')
    && scan.channels.length === 74
    && scan.direct_callsites.length === 253
    && scan.direct_files.length === 37
    && scan.capability_callsites.length === 73
    && scan.delegating_roots.length === 13
  if (!exact) throw new Error('[m5b-step6-fixture] checkout does not match the reviewed M5B-6 source delta')

  const fixture = {
    schema_version: 'm5b-step-source-delta-v1',
    step: 'M5B-6',
    source_digest: deltas.at(-1).target_digest,
    target_digest: scan.digest,
    expected_counts: {
      channels: scan.channels.length,
      direct_callsites: scan.direct_callsites.length,
      direct_files: scan.direct_files.length,
      capability_callsites: scan.capability_callsites.length,
      delegating_roots: scan.delegating_roots.length
    },
    removed_source: [],
    added_target: added.map((entry) => ({
      fingerprint: entry.fingerprint,
      file: entry.file,
      symbol: entry.symbol,
      line: entry.line,
      kind: entry.kind,
      callee: entry.callee,
      occurrence: entry.occurrence,
      target_class: targetClass(entry),
      planned_step: 'M5B-6'
    })),
    capability_removed_source: [],
    capability_added_target: []
  }
  if (existsSync(deltaPath)) {
    const frozen = JSON.parse(readFileSync(deltaPath, 'utf8'))
    if (!exactJson(frozen, fixture)) {
      if (process.argv.includes('--refresh-source-delta')) {
        writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
        return { status: 'refreshed', fixture }
      }
      throw new Error('[m5b-step6-fixture] frozen source delta differs from checkout')
    }
    return { status: 'verified', fixture }
  }
  writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  return { status: 'populated', fixture }
}

const delta = updateSourceDelta()
console.log(`[m5b-step6-fixture] source_delta=${delta.status}`)
console.log(
  `[m5b-step6-fixture] digest=${delta.fixture.target_digest}, direct_added=${delta.fixture.added_target.length}, capability_added=${delta.fixture.capability_added_target.length}`
)
