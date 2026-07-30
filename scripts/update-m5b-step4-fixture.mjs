#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadInventoryDocuments as loadM5aInventoryDocuments } from './lib/m5a-command-boundary-inventory.mjs'
import { scanM5bCheckout } from './lib/m5b-runtime-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const step2Path = resolve(projectRoot, 'scripts/fixtures/m5b-step2-source-delta-v1.json')
const step3Path = resolve(projectRoot, 'scripts/fixtures/m5b-step3-source-delta-v1.json')
const deltaPath = resolve(projectRoot, 'scripts/fixtures/m5b-step4-source-delta-v1.json')

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function step3DirectFingerprints(active, step2, step3) {
  const step2Removed = new Set(step2.removed_source.map((entry) => entry.fingerprint))
  const step2Target = new Set([
    ...active.direct_callsites
      .filter((entry) => !step2Removed.has(entry.fingerprint))
      .map((entry) => entry.fingerprint),
    ...step2.added_target.map((entry) => entry.fingerprint)
  ])
  const step3Removed = new Set(step3.removed_source.map((entry) => entry.fingerprint))
  return new Set([
    ...[...step2Target].filter((fingerprint) => !step3Removed.has(fingerprint)),
    ...step3.added_target.map((entry) => entry.fingerprint)
  ])
}

function updateSourceDelta() {
  const { active } = loadM5aInventoryDocuments(projectRoot)
  const step2 = JSON.parse(readFileSync(step2Path, 'utf8'))
  const step3 = JSON.parse(readFileSync(step3Path, 'utf8'))
  if (step3.step !== 'M5B-3' || step3.source_digest !== step2.target_digest) {
    throw new Error('[m5b-step4-fixture] source is not the accepted M5B-3 delta')
  }
  const scan = scanM5bCheckout(projectRoot)
  const sourceFingerprints = step3DirectFingerprints(active, step2, step3)
  const targetFingerprints = new Set(scan.direct_callsites.map((entry) => entry.fingerprint))
  const removed = [...sourceFingerprints].filter((fingerprint) => !targetFingerprints.has(fingerprint))
  const added = scan.direct_callsites.filter((entry) => !sourceFingerprints.has(entry.fingerprint))
  const exact = removed.length === 0
    && added.length === 3
    && added.every((entry) => entry.file === 'src/main/application/command/durable-command-store.ts')
    && scan.channels.length === 74
    && scan.direct_callsites.length === 239
    && scan.direct_files.length === 32
    && scan.capability_callsites.length === 72
    && scan.delegating_roots.length === 13
  if (!exact) throw new Error('[m5b-step4-fixture] checkout does not match the reviewed M5B-4 source delta')

  const fixture = {
    schema_version: 'm5b-step-source-delta-v1',
    step: 'M5B-4',
    source_digest: step3.target_digest,
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
      target_class: 'EVENT_BATCH_COMMAND_STORE_INTERNAL',
      planned_step: 'M5B-4'
    }))
  }
  if (existsSync(deltaPath)) {
    const frozen = JSON.parse(readFileSync(deltaPath, 'utf8'))
    if (!exactJson(frozen, fixture)) {
      if (process.argv.includes('--refresh-source-delta')) {
        writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
        return { status: 'refreshed', fixture }
      }
      throw new Error('[m5b-step4-fixture] frozen source delta differs from checkout')
    }
    return { status: 'verified', fixture }
  }
  writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  return { status: 'populated', fixture }
}

const delta = updateSourceDelta()
console.log(`[m5b-step4-fixture] source_delta=${delta.status}`)
console.log(`[m5b-step4-fixture] digest=${delta.fixture.target_digest}, added=${delta.fixture.added_target.length}`)
