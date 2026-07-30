#!/usr/bin/env node

import { fileURLToPath } from 'node:url'

import {
  formatM5bScopeReport,
  verifyM5bContractScope
} from './lib/m5b-contract-scope.mjs'

function parseArgs(argv) {
  let step = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--step') {
      step = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`[m5b-contract-scope] unknown arg: ${argv[index]}`)
  }
  if (!step) throw new Error('[m5b-contract-scope] --step is required')
  return { step }
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

try {
  const args = parseArgs(process.argv.slice(2))
  const report = verifyM5bContractScope({ projectRoot, step: args.step })
  console.log(formatM5bScopeReport(report))
  console.log(`[m5b-contract-scope] ${args.step} PASS`)
} catch (error) {
  if (error && typeof error === 'object' && error.report) {
    console.error(formatM5bScopeReport(error.report))
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
