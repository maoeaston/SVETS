import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const userDataDir = process.env.SVETS_DEV_USER_DATA_DIR
  ? resolve(process.env.SVETS_DEV_USER_DATA_DIR)
  : join(tmpdir(), 'xc-career-guide-dev')

mkdirSync(userDataDir, { recursive: true })
console.log(`[dev] Electron user data: ${userDataDir}`)

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(npmCommand, ['run', 'dev:electron-vite'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SVETS_E2E: '1',
    SVETS_USER_DATA_DIR: userDataDir
  },
  stdio: 'inherit'
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error('[dev] failed to start Electron-Vite:', error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[dev] Electron-Vite exited with ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
