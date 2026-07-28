import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const buildDir = mkdtempSync(join(projectRoot, '.tmp-m4-electron-bundle-'))
const bundlePath = join(buildDir, 'm4-native-electron.cjs')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit', ...options })
  if (result.status !== 0) process.exitCode = result.status ?? 1
  return result.status === 0
}

try {
  console.log('[db:m4:native:verify] Bundling the native verifier without loading better-sqlite3 in system Node')
  const bundled = run(
    resolve(projectRoot, 'node_modules/.bin/esbuild'),
    [
      'scripts/e2e/m4-native-electron.ts',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--external:better-sqlite3',
      `--outfile=${bundlePath}`
    ]
  )
  if (bundled) {
    console.log('[db:m4:native:verify] Running the verifier with Electron ABI 145')
    run(resolve(projectRoot, 'node_modules/.bin/electron'), [bundlePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true })
}
