#!/usr/bin/env node

import { verifyPreviewContractReady } from './lib/preview-contract-ready.mjs'

const argv = process.argv.slice(2)
const dbIndex = argv.indexOf('--db')
if (dbIndex < 0 || !argv[dbIndex + 1]) {
  console.error('[preview-ready] --db <explicit-absolute-path> is required')
  process.exitCode = 1
} else {
  try {
    const result = await verifyPreviewContractReady({ dbPath: argv[dbIndex + 1] })
    console.log(`[preview-ready] ${result.status} code=${result.code ?? 'NONE'}`)
    console.log(`[preview-ready] preview_contract=${result.preview_contract} migration_state=${result.migration_state}`)
    console.log('[preview-ready] ipc_source_digest=' + (result.ipc_source_digest ?? 'NONE') + ' ipc_counts=' + (result.ipc_counts ? JSON.stringify(result.ipc_counts) : 'NONE'))
    console.log(`[preview-ready] unmet=${result.unmet.join(',') || 'NONE'}`)
    if (result.status !== 'PASS') process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
