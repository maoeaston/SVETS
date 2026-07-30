#!/usr/bin/env node

import { fileURLToPath } from 'node:url'

import {
  loadM5bInventoryDocuments,
  scanM5bCheckout,
  validateM5bBaseline,
  validateM5bMigration
} from './lib/m5b-runtime-inventory.mjs'

function parseArgs(argv) {
  const args = { mode: 'baseline', step: null }
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
    throw new Error(`[m5b-event-batch] unknown arg: ${argv[index]}`)
  }
  if (!['baseline', 'migration', 'target'].includes(args.mode)) {
    throw new Error(`[m5b-event-batch] invalid mode: ${args.mode}`)
  }
  if (args.mode === 'migration' && !args.step) throw new Error('[m5b-event-batch] migration mode requires --step')
  if (args.mode === 'target' && args.step) throw new Error('[m5b-event-batch] target mode does not accept --step')
  if (args.mode === 'baseline' && args.step) throw new Error('[m5b-event-batch] baseline mode does not accept --step')
  return args
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

try {
  const args = parseArgs(process.argv.slice(2))
  const documents = loadM5bInventoryDocuments(projectRoot)
  if (args.mode === 'baseline') {
    const result = validateM5bBaseline(documents)
    console.log(
      `[m5b-event-batch] baseline PASS: target=${result.channels} channels (${result.reads} READ/${result.mutations} MUTATION), `
      + `${result.batch} BATCH_DOMAIN/${result.gate} GATE_ONLY; source active=${result.active_entries}, mapping=${result.mapping_entries}, exceptions=${result.exceptions}`
    )
  } else {
    const scan = scanM5bCheckout(projectRoot)
    const result = validateM5bMigration({
      scan,
      ...documents,
      step: args.mode === 'target' ? 'M5B-15' : args.step,
      target: args.mode === 'target'
    })
    console.log(
      `[m5b-event-batch] ${args.mode} PASS: target=${result.channels} channels (${result.reads} READ/${result.mutations} MUTATION), `
      + `${result.batch} BATCH_DOMAIN/${result.gate} GATE_ONLY; pending commands=${result.command_pending}, health=${result.health_pending}, `
      + `legacy=${result.legacy_pending}, report=${result.report_pending}; exceptions=${result.exceptions}; source_digest=${result.digest}`
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
