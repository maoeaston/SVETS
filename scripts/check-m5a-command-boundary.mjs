#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import {
  inventoryDigest,
  loadInventoryDocuments,
  scanCheckout,
  scanGitTree,
  validateBaselineInventory,
  validateMigrationInventory
} from './lib/m5a-command-boundary-inventory.mjs'

function parseArgs(argv) {
  const args = { mode: 'target', step: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--mode') {
      args.mode = argv[index + 1]
      index += 1
      continue
    }
    if (argv[index] === '--step') {
      args.step = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`[m5a-command-boundary] unknown arg: ${argv[index]}`)
  }
  if (!['baseline', 'migration', 'target'].includes(args.mode)) {
    throw new Error(`[m5a-command-boundary] invalid mode: ${args.mode}`)
  }
  if (args.mode === 'migration' && !args.step) throw new Error('[m5a-command-boundary] migration mode requires --step')
  if (args.mode !== 'migration' && args.step) throw new Error(`[m5a-command-boundary] --step is only valid in migration mode`)
  return args
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

try {
  const args = parseArgs(process.argv.slice(2))
  const documents = loadInventoryDocuments(projectRoot)
  if (args.mode === 'baseline') {
    const scan = scanGitTree(projectRoot, documents.legacy.base_commit)
    const result = validateBaselineInventory(scan, documents.legacy)
    console.log(`[m5a-command-boundary] baseline PASS: ${result.channels} channels (${result.reads} READ/${result.mutations} MUTATION), ${result.direct_files} direct files, ${result.delegating_roots} roots; digest=${inventoryDigest(scan)}`)
  } else {
    const scan = scanCheckout(projectRoot)
    const result = validateMigrationInventory({
      scan,
      ...documents,
      step: args.step,
      target: args.mode === 'target'
    })
    console.log(`[m5a-command-boundary] ${args.mode} PASS: ${result.channels} channels (${result.reads} READ/${result.mutations} MUTATION), ${result.direct_files} direct files, ${result.delegating_roots} roots, pending=${result.pending}, registered_exceptions=${result.registered_exceptions}; digest=${inventoryDigest(scan)}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
