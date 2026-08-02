#!/usr/bin/env node

import { validatePreviewContractIpcInventory } from './lib/preview-contract-ipc-inventory.mjs'

try {
  const { actual } = validatePreviewContractIpcInventory()
  console.log('[preview-ipc] PASS channels=' + actual.source_sets.channels.length + ' reads=' + actual.source_sets.reads.length + ' mutations=' + actual.source_sets.mutations.length)
  console.log('[preview-ipc] source_digest=' + actual.source_digest)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
