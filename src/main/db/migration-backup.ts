import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { MigrationBackupStage } from './migration-startup'

export type MigrationBackupResult = {
  backupDir: string
  manifestPath: string
}

export type MigrationBackupSource = {
  checkpointFull: () => void
  vacuumInto: (path: string) => void
  verifyBackup: (path: string) => void
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Creates a stage-labelled, byte-verifiable DB/action-log pair from explicit paths. */
export function createVerifiedMigrationBackup(options: {
  source: MigrationBackupSource
  dataDir: string
  actionLogPath: string
  stage: MigrationBackupStage
  migrationId: string
  now?: Date
}): MigrationBackupResult {
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const backupDir = join(options.dataDir, 'backups', `pre-migration.${options.stage.toLowerCase()}.${timestamp}`)
  const incompleteDir = `${backupDir}.INCOMPLETE`
  const databasePath = join(backupDir, 'xc-career-guide.db')
  const backupActionLogPath = join(backupDir, 'action_log.jsonl')
  try {
    mkdirSync(join(options.dataDir, 'backups'), { recursive: true })
    mkdirSync(backupDir, { recursive: false })
    options.source.checkpointFull()
    options.source.vacuumInto(databasePath)
    options.source.verifyBackup(databasePath)

    const actionLogPresent = existsSync(options.actionLogPath)
    const actionLogHash = actionLogPresent ? sha256File(options.actionLogPath) : null
    if (actionLogPresent) {
      copyFileSync(options.actionLogPath, backupActionLogPath)
      if (sha256File(backupActionLogPath) !== actionLogHash) {
        throw new Error('backup action log hash mismatch')
      }
    }
    const manifestPath = join(backupDir, 'manifest.json')
    writeFileSync(manifestPath, `${JSON.stringify({
      stage: options.stage,
      migration_id: options.migrationId,
      created_at: (options.now ?? new Date()).toISOString(),
      database: { file: 'xc-career-guide.db', sha256: sha256File(databasePath), integrity_check: 'ok' },
      action_log: actionLogPresent
        ? { status: 'PRESENT', file: 'action_log.jsonl', sha256: actionLogHash }
        : { status: 'ABSENT', file: null, sha256: null }
    }, null, 2)}\n`, 'utf8')
    return { backupDir, manifestPath }
  } catch (error) {
    if (existsSync(backupDir)) renameSync(backupDir, incompleteDir)
    throw error
  }
}
