#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  scanProductionSafetySql,
  validateSafetySqlInventory
} from './lib/multi-device-m4-safety-sql-inventory.mjs'

function parseArgs(argv) {
  const args = { mode: 'baseline' }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--mode') {
      args.mode = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`[m4-safety-sql-inventory] unknown arg: ${argv[index]}`)
  }
  return args
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const inventoryPath = join(projectRoot, 'doc/features/multi-device-m4-safety-sql-inventory-v1.json')

try {
  const args = parseArgs(process.argv.slice(2))
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  const result = validateSafetySqlInventory({
    hits: scanProductionSafetySql(projectRoot),
    inventory,
    mode: args.mode
  })
  console.log(`[m4-safety-sql-inventory] ${args.mode} PASS: ${result.hit_count} hits; ${JSON.stringify(result.classification_counts)}; version=${result.inventory_version}`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
