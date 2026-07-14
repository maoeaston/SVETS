#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDefaultDbPath } from './lib/database-path.mjs'
import { verifyDatabase } from './lib/database-content-pack.mjs'

function parseArgs(argv) {
  const args = { dbPath: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') {
      args.dbPath = argv[++i]
      continue
    }
    throw new Error(`[db:verify] 未知参数：${argv[i]}`)
  }
  return args
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const args = parseArgs(process.argv.slice(2))
const dbPath = args.dbPath ?? resolveDefaultDbPath({
  platform: process.platform,
  homeDir: homedir(),
  appName: pkg.name
})

try {
  const result = verifyDatabase(dbPath)
  console.log(`[db:verify] PASS ${result.dbPath}`)
  console.log(`[db:verify] schema=${result.schemaVersion} pack=${result.packVersion}`)
  console.log(`[db:verify] hash=${result.packHash}`)
} catch (error) {
  console.error(`[db:verify] ${error.message}`)
  process.exitCode = 1
}
