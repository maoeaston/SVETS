#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveDefaultDbPath } from './lib/database-path.mjs'
import { syncDatabase } from './lib/database-content-pack.mjs'

function parseArgs(argv) {
  const args = { dbPath: null, reset: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') {
      args.dbPath = argv[++i]
      continue
    }
    if (argv[i] === '--reset') {
      args.reset = true
      continue
    }
    throw new Error(`[db:sync] 未知参数：${argv[i]}`)
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
  const result = syncDatabase(dbPath, { reset: args.reset })
  if (result.backupPath) console.log(`[db:sync] 重建前备份：${result.backupPath}`)
  console.log(`[db:sync] 数据库：${result.dbPath}`)
  console.log(
    `[db:sync] 内容包 ${result.packVersion}：BASE=${result.counts.BASE_ABILITY}，` +
      `JOB=${result.counts.JOB_SPECIFIC}，approved assets=${result.approvedAssetCount}`
  )
  console.log(`[db:sync] 语义哈希：${result.packHash}`)
} catch (error) {
  console.error(`[db:sync] ${error.message}`)
  process.exitCode = 1
}
