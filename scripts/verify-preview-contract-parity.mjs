#!/usr/bin/env node

import { verifyPreviewContractParity } from './lib/preview-contract-parity.mjs'

function parseArgs(argv) {
  const args = { dbPath: null, includeIsolatedM5b: true }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--db' && argv[index + 1]) {
      args.dbPath = argv[index + 1]
      index += 1
      continue
    }
    if (argv[index] === '--skip-isolated-m5b') {
      args.includeIsolatedM5b = false
      continue
    }
    throw new Error(`[preview-parity] unknown argument ${argv[index]}`)
  }
  if (!args.dbPath) throw new Error('[preview-parity] --db <explicit-absolute-path> is required')
  return args
}

try {
  const args = parseArgs(process.argv.slice(2))
  const result = await verifyPreviewContractParity({
    dbPath: args.dbPath,
    includeIsolatedM5b: args.includeIsolatedM5b
  })
  console.log(`[preview-parity] ${result.status} code=${result.code ?? 'NONE'}`)
  console.log(`[preview-parity] schema=${result.content_pack.schemaVersion} migration=${result.content_pack.migrationId}`)
  console.log(`[preview-parity] ledger_digest=${result.ledger_digest.m5b} object_digest=${result.object_digest.m5b}`)
  console.log(`[preview-parity] preview_contract=${result.preview_contract}`)
  console.log(`[preview-parity] unmet=${result.unmet.join(',')}`)
  if (result.status !== 'PASS') process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
