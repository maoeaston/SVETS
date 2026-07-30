#!/usr/bin/env node
import { fileURLToPath } from 'node:url'

import {
  M5A_SCOPE_BASE_COMMIT,
  M5aContractScopeError,
  collectM5aContractScope,
  formatM5aScopeReport,
  verifyM5aContractScope
} from './lib/m5a-contract-scope.mjs'

function parseArgs(argv) {
  const args = { baseCommit: M5A_SCOPE_BASE_COMMIT }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') {
      const value = argv[index + 1]
      if (!value) throw new Error('[m5a-contract-scope] --base requires a commit')
      if (value !== M5A_SCOPE_BASE_COMMIT) {
        throw new Error(`[m5a-contract-scope] base must remain fixed at ${M5A_SCOPE_BASE_COMMIT}`)
      }
      args.baseCommit = value
      index += 1
      continue
    }
    throw new Error(`[m5a-contract-scope] unknown arg: ${argv[index]}`)
  }
  return args
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

try {
  const args = parseArgs(process.argv.slice(2))
  const report = verifyM5aContractScope({ projectRoot, baseCommit: args.baseCommit })
  console.log(formatM5aScopeReport(report))
  console.log(`[m5a-contract-scope] PASS base=${report.baseCommit}; committed/index/working-tree/untracked restricted changes=0`)
} catch (error) {
  if (error instanceof M5aContractScopeError) {
    console.error(formatM5aScopeReport(error.report))
  } else {
    try {
      const args = parseArgs(process.argv.slice(2))
      const report = collectM5aContractScope({ projectRoot, baseCommit: args.baseCommit })
      console.error(formatM5aScopeReport(report))
    } catch {
      // The original error is the useful failure when the repository/base cannot be inspected.
    }
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
