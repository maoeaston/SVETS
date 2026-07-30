#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadInventoryDocuments as loadM5aInventoryDocuments } from './lib/m5a-command-boundary-inventory.mjs'
import { scanM5bCheckout } from './lib/m5b-runtime-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const previousDeltaPaths = Array.from({ length: 9 }, (_, index) => index + 2).map((step) => resolve(
  projectRoot,
  `scripts/fixtures/m5b-step${step}-source-delta-v1.json`
))
const deltaPath = resolve(projectRoot, 'scripts/fixtures/m5b-step11-source-delta-v1.json')

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sourceEntries(active, deltas) {
  const entries = new Map(active.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  for (const delta of deltas) {
    for (const entry of delta.removed_source) entries.delete(entry.fingerprint)
    for (const entry of delta.added_target) entries.set(entry.fingerprint, entry)
  }
  return entries
}

function capabilityFingerprints(active, deltas) {
  const fingerprints = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  for (const delta of deltas) {
    for (const entry of delta.capability_removed_source ?? []) fingerprints.delete(entry.fingerprint)
    for (const entry of delta.capability_added_target ?? []) fingerprints.add(entry.fingerprint)
  }
  return fingerprints
}

export function verifyM5bStep11SourceDelta() {
  const { active } = loadM5aInventoryDocuments(projectRoot)
  const deltas = previousDeltaPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  for (let index = 0; index < deltas.length; index += 1) {
    const expectedStep = `M5B-${index + 2}`
    const expectedSource = index === 0 ? active.source_digest : deltas[index - 1].target_digest
    if (deltas[index].step !== expectedStep || deltas[index].source_digest !== expectedSource) {
      throw new Error(`[m5b-step11-fixture] ${expectedStep} source chain is not accepted`)
    }
  }
  const source = sourceEntries(active, deltas)
  const scan = scanM5bCheckout(projectRoot)
  const checkout = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  const removed = [...source.values()].filter((entry) => !checkout.has(entry.fingerprint))
  const added = [...checkout.values()].filter((entry) => !source.has(entry.fingerprint))
  const sourceCapabilities = capabilityFingerprints(active, deltas)
  const targetCapabilities = new Set(scan.capability_callsites.map((entry) => entry.fingerprint))
  const removedCapabilities = [...sourceCapabilities].filter((fingerprint) => !targetCapabilities.has(fingerprint))
  const addedCapabilities = scan.capability_callsites.filter((entry) => !sourceCapabilities.has(entry.fingerprint))
  const exactCapabilities = removedCapabilities.length === 0
    && addedCapabilities.length === 0
  const addedTarget = added.map((entry) => ({
    ...entry,
    target_class: 'ASSIGNMENT_RUNTIME_PREPARED_EFFECT',
    planned_step: 'M5B-11'
  }))
  const removedSource = removed.map((entry) => ({
    ...entry,
    disposition: 'REFACTORED_TO_PREPARED_RUNTIME_EFFECT'
  }))
  const exact = exactCapabilities
    && removedSource.length === 5
    && addedTarget.length === 5

  const fixture = {
    schema_version: 'm5b-step-source-delta-v1',
    step: 'M5B-11',
    source_digest: deltas.at(-1).target_digest,
    target_digest: scan.digest,
    expected_counts: {
      channels: scan.channels.length,
      direct_callsites: scan.direct_callsites.length,
      direct_files: scan.direct_files.length,
      capability_callsites: scan.capability_callsites.length,
      delegating_roots: scan.delegating_roots.length
    },
    removed_source: removedSource,
    added_target: addedTarget,
    capability_removed_source: [],
    capability_added_target: []
  }
  if (!exact) throw new Error('[m5b-step11-fixture] checkout does not match the reviewed M5B-11 source delta')
  if (existsSync(deltaPath)) {
    const frozen = JSON.parse(readFileSync(deltaPath, 'utf8'))
    if (!exactJson(frozen, fixture)) {
      if (process.argv.includes('--refresh-source-delta')) {
        writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
        return { status: 'refreshed', fixture }
      }
      throw new Error('[m5b-step11-fixture] frozen source delta differs from checkout')
    }
    return { status: 'verified', fixture }
  }
  writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  return { status: 'populated', fixture }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const delta = verifyM5bStep11SourceDelta()
  console.log(`[m5b-step11-fixture] source_delta=${delta.status}`)
  console.log(
    `[m5b-step11-fixture] digest=${delta.fixture.target_digest}, direct_added=${delta.fixture.added_target.length}, capability_added=${delta.fixture.capability_added_target.length}`
  )
}
