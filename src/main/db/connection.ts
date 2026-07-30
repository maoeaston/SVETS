import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { hashPassword } from '../utils/password'
import devAccounts from '../../shared/config/dev-accounts.json'
import type { DBAdapter } from './interface'
import { resolveActionLogPath } from '../domain/action-log-path'
import {
  createInternalMutationCapability,
  prepareInternalDirectory
} from '../application/runtime/internal-mutation-capability'
import { writeEvent } from '../domain/event-writer'
import { preReconcileLegacyActionLog, StartupRecoveryRequiredError } from '../domain/legacy-upgrade-recovery'
import { reconcileActionLog, writeRecoverySnapshot } from '../domain/recovery'
import {
  assertCurrentDatabaseSchema,
  M4_SCHEMA_VERSION,
  isFreshDatabase
} from './migrations'
import { createVerifiedMigrationBackup } from './migration-backup'
import { orchestrateDatabaseStartupUpgrade } from './migration-startup'
import { normalizeStartupUpgradeError } from '../startup-error'

let db: Database.Database | null = null

type StartupUpgradeDatabase = Pick<Database.Database, 'pragma' | 'exec'>

export type ConnectionStartupUpgradeDependencies = {
  preReconcileF7?: () => void
  createVerifiedBackup?: (stage: 'F7' | 'M4', migrationId: string) => void
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('[DB] Not initialized — call initDatabase() first')
  }
  return db
}

export function initDatabase(): void {
  const dataDir = join(app.getPath('userData'), 'data')
  prepareInternalDirectory(createInternalMutationCapability({
    owner: 'database-connection:startup-upgrade-recovery',
    phase: 'DB_INIT_RECOVERY',
    dataRoot: dataDir
  }), dataDir)

  const dbPath = join(dataDir, 'xc-career-guide.db')
  const database = new Database(dbPath)

  try {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')

    const schemaPath = join(__dirname, 'schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    const adapter = database as unknown as DBAdapter
    const fresh = isFreshDatabase(adapter)
    const actionLogPath = resolveActionLogPath(dataDir)
    if (fresh && hasNonEmptyActionLog(actionLogPath)) {
      throw new StartupRecoveryRequiredError(
        'FRESH_DATABASE_WITH_ACTION_LOG',
        'A fresh database cannot be paired with a non-empty action log'
      )
    }

    const migrated = runConnectionStartupUpgrade({
      database,
      adapter,
      dataDir,
      actionLogPath
    })

    database.transaction(() => database.exec(schema))()
    assertCurrentDatabaseSchema(adapter)
    seedDevUsers(database)
    db = database
    const recovery = recoverActionLog(database, dbPath, actionLogPath)

    if (fresh) console.log('[DB] Initialized fresh schema')
    if (migrated.length > 0) console.log(`[DB] Applied migrations: ${migrated.join(', ')}`)
    console.log(
      `[DB] Recovery: replayed=${recovery.replayedEventCount}, skipped=${recovery.skippedEventCount}, truncatedTail=${recovery.truncatedTail}`
    )
    console.log(`[DB] Ready: ${dbPath}`)
  } catch (error) {
    database.close()
    db = null
    throw error
  }
}

/**
 * Connection-layer bridge for non-fresh databases. Keeping the M4 wiring here
 * lets its stage, backup, and error boundary be regression-tested without a
 * native Electron SQLite runtime.
 */
export function runConnectionStartupUpgrade(options: {
  database: StartupUpgradeDatabase
  adapter: DBAdapter
  dataDir: string
  actionLogPath: string
  dependencies?: ConnectionStartupUpgradeDependencies
}): string[] {
  const { database, adapter, dataDir, actionLogPath, dependencies = {} } = options
  try {
    return orchestrateDatabaseStartupUpgrade(adapter, {
      preReconcileF7: dependencies.preReconcileF7 ?? (() => preReconcileLegacyActionLog(adapter, {
        logPath: actionLogPath,
        archiveDir: join(dirname(actionLogPath), 'recovery-archive')
      })),
      createVerifiedBackup: dependencies.createVerifiedBackup ?? ((stage, migrationId) => {
        const backup = createVerifiedMigrationBackup({
          source: {
            checkpointFull: () => database.pragma('wal_checkpoint(FULL)'),
            vacuumInto: (path) => database.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`),
            verifyBackup: (path) => {
              const backupDatabase = new Database(path, { readonly: true })
              try {
                const integrity = backupDatabase.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>
                if (integrity.map((row) => Object.values(row)[0]).join(',') !== 'ok') {
                  throw new Error('backup database integrity_check failed')
                }
              } finally {
                backupDatabase.close()
              }
            }
          },
          dataDir,
          actionLogPath,
          stage,
          migrationId
        })
        console.log(`[DB] Paired ${stage} backup before ${migrationId}: ${backup.backupDir}`)
      })
    })
  } catch (error) {
    throw normalizeStartupUpgradeError(error)
  }
}

function recoverActionLog(database: Database.Database, dbPath: string, actionLogPath: string): {
  replayedEventCount: number
  skippedEventCount: number
  truncatedTail: boolean
} {
  const recovery = reconcileActionLog(database as unknown as DBAdapter, {
    logPath: actionLogPath,
    archiveDir: join(dirname(actionLogPath), 'recovery-archive')
  })

  // 快照记录的是恢复前已落盘 SQLite 文件的校验值。随后用同一事务写入恢复审计和
  // snapshot_meta，避免审计事件已经可见而快照元数据缺失。
  database.pragma('wal_checkpoint(PASSIVE)')
  const sqliteFileHash = createHash('sha256').update(readFileSync(dbPath)).digest('hex')

  database.transaction(() => {
    const recoveryEvent = writeEvent({
      aggregateType: 'SYSTEM',
      aggregateId: `startup-recovery:${Date.now()}`,
      eventType: recovery.truncatedTail ? 'RECOVERY_LOG_TRUNCATED' : 'RECOVERY_REPLAYED',
      payload: {
        replayed_event_count: recovery.replayedEventCount,
        skipped_event_count: recovery.skippedEventCount,
        truncated_tail: recovery.truncatedTail,
        archived_tail_path: recovery.archivedTailPath
      },
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      database: database as unknown as DBAdapter,
      actionLogPath
    })
    writeRecoverySnapshot(database as unknown as DBAdapter, {
      lastAppliedEvent: recoveryEvent,
      sqliteFileHash,
      actionLogPath,
      archivedLogPath: recovery.archivedTailPath,
      schemaVersion: M4_SCHEMA_VERSION,
      appVersion: app.getVersion()
    })
  })()

  return recovery
}

function hasNonEmptyActionLog(actionLogPath: string): boolean {
  return existsSync(actionLogPath) && readFileSync(actionLogPath, 'utf8').trim().length > 0
}


function seedDevUsers(database: Database.Database): void {
  const tx = database.transaction(() => {
    const insertAccount = database.prepare(`
      INSERT OR IGNORE INTO user_account
        (user_id, username, password_hash, role, display_name, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `)
    for (const account of devAccounts) {
      insertAccount.run(
        account.userId,
        account.username,
        hashPassword(account.password),
        account.role,
        account.displayName
      )
    }

    database.prepare(`
      INSERT INTO student_profile (student_id, student_name, user_id, status)
      SELECT 'seed-student-001', '测试学生', user_id, 'ACTIVE'
      FROM user_account
      WHERE username = 'student'
      ON CONFLICT(student_id) DO UPDATE SET
        user_id = COALESCE(student_profile.user_id, excluded.user_id)
    `).run()
  })
  tx()
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    console.log('[DB] Closed')
  }
}
