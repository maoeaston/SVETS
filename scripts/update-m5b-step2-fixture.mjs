#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  M5B_SOURCE_DIGEST,
  scanM5bCheckout
} from './lib/m5b-runtime-inventory.mjs'
import { loadInventoryDocuments as loadM5aInventoryDocuments } from './lib/m5a-command-boundary-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const outputPath = resolve(projectRoot, 'scripts/fixtures/m5b-step2-source-delta-v1.json')

if (existsSync(outputPath)) {
  console.error('[m5b-step2-fixture] fixture is frozen and will not be overwritten')
  process.exitCode = 1
} else {
  const { active } = loadM5aInventoryDocuments(projectRoot)
  const scan = scanM5bCheckout(projectRoot)
  const sourceDirect = new Map(active.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  const targetDirect = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  const removed = [...sourceDirect.values()].filter((entry) => !targetDirect.has(entry.fingerprint))
  const added = [...targetDirect.values()].filter((entry) => !sourceDirect.has(entry.fingerprint))

  const movedSourceIds = ['ACTIVE-DIRECT-012', 'ACTIVE-DIRECT-013', 'ACTIVE-DIRECT-014']
  const movedTargets = added.filter((entry) => entry.file === 'src/main/db/memory-adapter.ts')
  const infrastructureTargets = added.filter((entry) => entry.file === 'src/main/db/event-batch-migration.ts')
  const exact = removed.length === 3
    && removed.every((entry) => movedSourceIds.includes(entry.id))
    && movedTargets.length === 3
    && infrastructureTargets.length === 3
    && added.length === 6
    && scan.channels.length === 74
    && scan.capability_callsites.length === 72
    && scan.direct_callsites.length === 218
  if (!exact) {
    throw new Error('[m5b-step2-fixture] checkout does not match the reviewed M5B-2 source delta')
  }

  const fixture = {
    schema_version: 'm5b-step-source-delta-v1',
    step: 'M5B-2',
    source_digest: M5B_SOURCE_DIGEST,
    target_digest: scan.digest,
    expected_counts: {
      channels: scan.channels.length,
      direct_callsites: scan.direct_callsites.length,
      direct_files: scan.direct_files.length,
      capability_callsites: scan.capability_callsites.length,
      delegating_roots: scan.delegating_roots.length
    },
    removed_source: removed.map((entry) => ({
      active_id: entry.id,
      fingerprint: entry.fingerprint,
      file: entry.file,
      symbol: entry.symbol,
      disposition: 'REFACTORED_TO_SHARED_TRANSACTION_KERNEL'
    })),
    added_target: added.map((entry) => ({
      fingerprint: entry.fingerprint,
      file: entry.file,
      symbol: entry.symbol,
      line: entry.line,
      kind: entry.kind,
      callee: entry.callee,
      occurrence: entry.occurrence,
      target_class: entry.file === 'src/main/db/event-batch-migration.ts'
        ? 'PRE_GATE_MIGRATION_INTERNAL'
        : 'TEST_ONLY_ADAPTER_INFRASTRUCTURE',
      planned_step: 'M5B-2'
    }))
  }
  writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  console.log(`[m5b-step2-fixture] wrote ${outputPath}`)
  console.log(`[m5b-step2-fixture] digest=${fixture.target_digest}, removed=${removed.length}, added=${added.length}`)
}
