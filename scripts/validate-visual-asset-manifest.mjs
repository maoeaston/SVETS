#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateVisualAssetManifest } from './lib/visual-asset-manifest.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = join(projectRoot, 'doc', 'assets', 'asset-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const result = validateVisualAssetManifest(manifest, { projectRoot })

for (const warning of result.warnings) console.warn(`[asset-manifest] WARN ${warning}`)
if (!result.ok) {
  for (const error of result.errors) console.error(`[asset-manifest] ERROR ${error}`)
  process.exit(1)
}

console.log(
  `[asset-manifest] valid: total=${result.summary.total}, planned=${result.summary.planned}, approved=${result.summary.approved}`
)
