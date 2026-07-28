#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { writeOrCheckBaseAbilityAuthority } from './lib/base-ability-42plus8-authority.mjs'
import { writeOrCheckBaseAbilityGate } from './lib/base-ability-42plus8-gate.mjs'

function parseArgs(argv) {
  const args = { check: false }
  for (const token of argv) {
    if (token === '--check') {
      args.check = true
      continue
    }
    throw new Error(`[base-ability-authority] unknown arg: ${token}`)
  }
  return args
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

try {
  const args = parseArgs(process.argv.slice(2))
  const authority = await writeOrCheckBaseAbilityAuthority(projectRoot, { check: args.check })
  if (!authority.ok) {
    console.error(`[base-ability-authority] stale: ${authority.outputPath}`)
    process.exit(1)
  }
  if (!args.check) await writeOrCheckBaseAbilityGate(projectRoot)
  console.log(
    `[base-ability-authority] ${args.check ? 'current' : 'built'}: `
    + `${authority.document.summary.selected_online_total}+${authority.document.summary.selected_offline_total} DRAFT; `
    + `hash=${authority.document.authority_hash}`
  )
} catch (error) {
  console.error(`[base-ability-authority] ${error.message}`)
  process.exit(1)
}
