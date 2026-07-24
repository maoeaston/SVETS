import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildAuthority } from './build-job-skill-shelver-298-authority.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'doc/features/job-skill-shelver-298-disposition-authority-v1.json')
const expected = `${JSON.stringify(buildAuthority({ write: false }), null, 2)}\n`
const actual = readFileSync(output, 'utf8')

if (actual !== expected) {
  throw new Error('Disposition authority is stale. Run npm run contract:job-skill:build and review the diff.')
}

console.log('[job-skill-contract-chain] authority is current and runtime SQL remains blocked')
