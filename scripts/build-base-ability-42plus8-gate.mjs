#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { writeOrCheckBaseAbilityGate } from './lib/base-ability-42plus8-gate.mjs'

function parseArgs(argv) {
  const args = { check: false }
  for (const token of argv) {
    if (token === '--check') {
      args.check = true
      continue
    }
    throw new Error(`[base-ability-gate] unknown arg: ${token}`)
  }
  return args
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

try {
  const args = parseArgs(process.argv.slice(2))
  const result = await writeOrCheckBaseAbilityGate(projectRoot, { check: args.check })
  const summary = result.document.summary
  if (!result.ok) {
    console.error(`[base-ability-gate] stale: ${result.outputPath}`)
    process.exit(1)
  }
  console.log(
    `[base-ability-gate] ${args.check ? 'current' : 'built'}: `
    + `${summary.source_question_total} candidates; `
    + `online=${summary.online_candidate_total}, offline=${summary.offline_candidate_total}, `
    + `observation=${summary.observation_only_total}; status=${result.document.status}`
  )
} catch (error) {
  console.error(`[base-ability-gate] ${error.message}`)
  process.exit(1)
}
