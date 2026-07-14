#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDefaultDbPath } from './lib/database-path.mjs'
import { buildDevAccountSeedSql, loadDevAccounts } from './lib/dev-accounts.mjs'
import { executeSqliteScript } from './lib/sqlite-cli.mjs'

function parseArgs(argv) {
  const args = { dbPath: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') {
      args.dbPath = argv[++i]
      continue
    }
    throw new Error(`[seed] 未知参数：${argv[i]}`)
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

if (!existsSync(dbPath)) {
  console.error(`[seed] DB 文件不存在：${dbPath}`)
  console.error('[seed] 请先执行 npm run db:sync。')
  process.exit(1)
}

const accounts = loadDevAccounts(projectRoot)
const sql = `BEGIN IMMEDIATE;\n${buildDevAccountSeedSql(accounts)}\nCOMMIT;`

try {
  executeSqliteScript(dbPath, sql, { stdio: ['ignore', 'inherit', 'inherit'] })
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('[seed] 未找到 sqlite3 CLI。')
  } else {
    console.error(`[seed] sqlite3 执行失败：${error.message}`)
  }
  process.exit(1)
}

console.log(`[seed] 已按共享合同更新 ${accounts.length} 个开发账号：${dbPath}`)
