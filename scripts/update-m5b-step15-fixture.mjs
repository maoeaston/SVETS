#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadInventoryDocuments as loadM5aInventoryDocuments } from './lib/m5a-command-boundary-inventory.mjs'
import { scanM5bCheckout } from './lib/m5b-runtime-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const priorSteps = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 12, 14]
const priorDeltaPaths = priorSteps.map((step) => resolve(projectRoot, `scripts/fixtures/m5b-step${step}-source-delta-v1.json`))
const deltaPath = resolve(projectRoot, 'scripts/fixtures/m5b-step15-source-delta-v1.json')

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

function directTargetClass(entry) {
  if (entry.file === 'src/main/application/planners/assignment-planner.ts') return 'ASSIGNMENT_PLANNING_PROJECTION_SEED'
  if (entry.file === 'src/main/db/sqlite-adapter.ts') return 'PREPARE_ONLY_PLANNING_CLONE'
  throw new Error(`[m5b-step15-fixture] unexpected direct addition ${entry.file}:${entry.symbol}`)
}

export function verifyM5bStep15SourceDelta() {
  const { active } = loadM5aInventoryDocuments(projectRoot)
  const deltas = priorDeltaPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  for (let index = 0; index < deltas.length; index += 1) {
    const expectedStep = `M5B-${priorSteps[index]}`
    const expectedSource = index === 0 ? active.source_digest : deltas[index - 1].target_digest
    if (deltas[index].step !== expectedStep || deltas[index].source_digest !== expectedSource) {
      throw new Error(`[m5b-step15-fixture] ${expectedStep} source chain is not accepted`)
    }
  }
  const sourceDirect = entriesAfter(active.direct_callsites, deltas, 'removed_source', 'added_target')
  const scan = scanM5bCheckout(projectRoot)
  const source = new Map(sourceDirect)
  const checkout = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  const removed = [...source.values()].filter((entry) => !checkout.has(entry.fingerprint))
  const added = [...checkout.values()].filter((entry) => !source.has(entry.fingerprint))
  const fixture = {
    schema_version: 'm5b-step-source-delta-v1',
    step: 'M5B-15',
    source_digest: deltas.at(-1).target_digest,
    target_digest: scan.digest,
    expected_counts: {
      channels: scan.channels.length,
      direct_callsites: scan.direct_callsites.length,
      direct_files: scan.direct_files.length,
      capability_callsites: scan.capability_callsites.length,
      delegating_roots: scan.delegating_roots.length
    },
    removed_source: removed.map((entry) => ({ ...entry, disposition: 'REMOVED_IN_M5B_15_REPAIR' })),
    added_target: added.map((entry) => ({ ...entry, target_class: directTargetClass(entry), planned_step: 'M5B-15' })),
    capability_removed_source: [],
    capability_added_target: [],
    channel_removed_source: [],
    channel_added_target: [],
    delegating_root_removed_source: [],
    delegating_root_added_target: []
  }
  const exact = removed.length === 0 && added.length === 4
    && fixture.added_target.filter((entry) => entry.target_class === 'ASSIGNMENT_PLANNING_PROJECTION_SEED').length === 1
    && fixture.added_target.filter((entry) => entry.target_class === 'PREPARE_ONLY_PLANNING_CLONE').length === 3
  if (!exact) throw new Error('[m5b-step15-fixture] checkout does not match the reviewed M5B-15 source delta')
  if (existsSync(deltaPath)) {
    const frozen = JSON.parse(readFileSync(deltaPath, 'utf8'))
    if (!exactJson(frozen, fixture)) {
      if (process.argv.includes('--refresh-source-delta')) {
        writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
        return { status: 'refreshed', fixture }
      }
      throw new Error('[m5b-step15-fixture] frozen source delta differs from checkout')
    }
    return { status: 'verified', fixture }
  }
  writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  return { status: 'populated', fixture }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const delta = verifyM5bStep15SourceDelta()
  console.log(`[m5b-step15-fixture] source_delta=${delta.status}`)
  console.log(`[m5b-step15-fixture] digest=${delta.fixture.target_digest}, direct_removed=${delta.fixture.removed_source.length}, direct_added=${delta.fixture.added_target.length}`)
}
