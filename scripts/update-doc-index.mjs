#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDocInventory, updateDocIndexContent } from './lib/doc-index.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const indexPath = join(projectRoot, 'doc', 'index.md')
const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--check')) {
  throw new Error('[doc-index] supported arguments: --check')
}

const current = readFileSync(indexPath, 'utf8')
const next = updateDocIndexContent(current, renderDocInventory(projectRoot))

if (args.includes('--check')) {
  if (next !== current) {
    console.error('[doc-index] doc/index.md is stale; run npm run docs:index:update')
    process.exit(1)
  }
  console.log('[doc-index] doc/index.md is current')
} else {
  writeFileSync(indexPath, next, 'utf8')
  console.log('[doc-index] updated doc/index.md')
}
