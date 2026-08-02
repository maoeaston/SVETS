import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const buildDir = mkdtempSync(join(projectRoot, '.tmp-preview-contract-native-bundle-'))
const bundlePath = join(buildDir, 'preview-contract-native-electron.cjs')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit', ...options })
  if (result.status !== 0) process.exitCode = result.status ?? 1
  return result.status === 0
}

try {
  console.log('[db:preview:native:verify] Bundling native preview migration verifier for Electron ABI execution')
  const bundled = run(resolve(projectRoot, 'node_modules/.bin/esbuild'), [
    'scripts/e2e/preview-contract-native-electron.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:better-sqlite3',
    `--outfile=${bundlePath}`
  ])
  if (bundled) {
    run(resolve(projectRoot, 'node_modules/.bin/electron'), [bundlePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true })
}
