#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildJobSkillPhase4Ledger,
  buildJobSkillPhase4Contracts,
  jobSkillPhase4Paths,
  verifyJobSkillPhase4Contracts
} from './lib/job-skill-phase4-contract.mjs'

const root = resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')

if (checkOnly) {
  const { authority, gate } = verifyJobSkillPhase4Contracts({ root })
  console.log(`[job-skill-phase4] current: ${authority.summary.retained_total} retained DRAFT questions; gate=${gate.status}`)
} else {
  const { authority, gate } = buildJobSkillPhase4Contracts({ root })
  writeFileSync(resolve(root, jobSkillPhase4Paths.runtimeAuthority), `${JSON.stringify(authority, null, 2)}\n`)
  writeFileSync(resolve(root, jobSkillPhase4Paths.activationGate), `${JSON.stringify(gate, null, 2)}\n`)
  writeFileSync(resolve(root, jobSkillPhase4Paths.activationLedger), buildJobSkillPhase4Ledger({ authority, gate }))
  console.log(`[job-skill-phase4] built: ${authority.summary.retained_total} retained DRAFT questions; gate=${gate.status}`)
}
