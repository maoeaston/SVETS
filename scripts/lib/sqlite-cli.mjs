import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function quoteDotCommandPath(filePath) {
  return `"${filePath.replaceAll('"', '""')}"`
}

export function executeSqliteScript(dbPath, sql, options = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'xc-sqlite-script-'))
  const sqlPath = join(tempDir, 'batch.sql')
  writeFileSync(sqlPath, sql, 'utf8')
  try {
    return runSqliteCommand([dbPath, `.read ${quoteDotCommandPath(sqlPath)}`], options)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function runSqliteCommand(args, options = {}) {
  const result = spawnSync('sqlite3', args, { maxBuffer: 16 * 1024 * 1024, ...options })
  if (result.status === 0) return result.stdout
  if (result.error) throw result.error

  const stderr = result.stderr ? String(result.stderr).trim() : ''
  const error = new Error(stderr || `sqlite3 exited with status ${result.status}`)
  error.code = result.status
  throw error
}

export function assertSqliteCliAvailable() {
  runSqliteCommand(['--version'], { stdio: 'ignore' })
}
