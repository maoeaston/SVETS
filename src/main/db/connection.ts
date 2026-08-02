import Database from 'better-sqlite3'
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
import { preReconcileLegacyActionLog, StartupRecoveryRequiredError } from '../domain/legacy-upgrade-recovery'
import {
  assertCurrentDatabaseSchema,
  isFreshDatabase
} from './migrations'
import { createVerifiedMigrationBackup } from './migration-backup'
import { orchestrateDatabaseStartupUpgrade } from './migration-startup'
import { normalizeStartupUpgradeError } from '../startup-error'
import {
  applyEventBatchMigration,
  assertExactEventBatchStructure,
  EVENT_BATCH_MIGRATION_ID
} from './event-batch-migration'
import {
  applyPreviewContractMigration
} from './preview-contract-migration'
import { PREVIEW_CONTRACT_MIGRATION_ID } from '../../shared/types/preview-contract'
import type { MigrationBackupStage } from './migration-startup'
import { seedBundledQuestionContent } from './content-pack-seed'
import contentPack from '../../../scripts/config/database-content-pack.json'

let db: Database.Database | null = null

type StartupUpgradeDatabase = Pick<Database.Database, 'pragma' | 'exec'>

export type ConnectionStartupUpgradeDependencies = {
  preReconcileF7?: () => void
  createVerifiedBackup?: (stage: MigrationBackupStage, migrationId: string) => void
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

    const eventBatch = runConnectionEventBatchCutover({
      adapter,
      fresh,
      loadTargetSchema: () => database.transaction(() => database.exec(schema))(),
      reconcileHistorical: () => preReconcileLegacyActionLog(adapter, {
        logPath: actionLogPath,
        archiveDir: join(dirname(actionLogPath), 'recovery-archive')
      }),
      createVerifiedBackup: () => createM5bVerifiedBackup({ database, dataDir, actionLogPath }),
      applyPreviewContract: () => applyPreviewContractMigration(adapter, {
        fresh,
        createVerifiedBackupBeforeDdl: () => createPreviewVerifiedBackup({ database, dataDir, actionLogPath })
      })
    })
    seedDevUsers(database)
    seedBundledQuestionContent(database as unknown as DBAdapter, [
      {
        domain: 'BASE_ABILITY',
        expectedCount: contentPack.questionContracts.find((item) => item.domain === 'BASE_ABILITY')!.expectedCount,
        sql: readFileSync(join(__dirname, 'content/question-bank-base-ability.sql'), 'utf8')
      },
      {
        domain: 'JOB_SPECIFIC',
        expectedCount: contentPack.questionContracts.find((item) => item.domain === 'JOB_SPECIFIC')!.expectedCount,
        sql: readFileSync(join(__dirname, 'content/question-bank-job-specific.sql'), 'utf8')
      }
    ])
    db = database

    if (fresh) console.log('[DB] Initialized fresh schema')
    if (migrated.length > 0) console.log(`[DB] Applied migrations: ${migrated.join(', ')}`)
    if (eventBatch.applied) console.log(`[DB] Applied migration: ${EVENT_BATCH_MIGRATION_ID}`)
    console.log(`[DB] Ready: ${dbPath}`)
  } catch (error) {
    database.close()
    db = null
    throw error
  }
}

export function runConnectionEventBatchCutover(options: {
  adapter: DBAdapter
  fresh: boolean
  loadTargetSchema: () => void
  reconcileHistorical: () => void
  createVerifiedBackup: () => void
  applyPreviewContract?: () => void
}): { source: string; applied: boolean } {
  if (options.fresh) {
    options.loadTargetSchema()
    assertCurrentDatabaseSchema(options.adapter)
    const migration = applyEventBatchMigration(options.adapter)
    assertExactEventBatchStructure(options.adapter)
    options.applyPreviewContract?.()
    return migration
  }

  // Historical data must be reconciled and backed up before the full v2
  // schema is allowed to create any event-batch object.
  assertCurrentDatabaseSchema(options.adapter)
  options.reconcileHistorical()
  const migration = applyEventBatchMigration(options.adapter, {
    createVerifiedBackupBeforeDdl: options.createVerifiedBackup
  })
  options.applyPreviewContract?.()
  options.loadTargetSchema()
  assertExactEventBatchStructure(options.adapter)
  return migration
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

function createM5bVerifiedBackup(options: {
  database: Database.Database
  dataDir: string
  actionLogPath: string
}): void {
  const backup = createVerifiedMigrationBackup({
    source: {
      checkpointFull: () => options.database.pragma('wal_checkpoint(FULL)'),
      vacuumInto: (path) => options.database.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`),
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
    dataDir: options.dataDir,
    actionLogPath: options.actionLogPath,
    stage: 'M5B',
    migrationId: EVENT_BATCH_MIGRATION_ID
  })
  console.log(`[DB] Paired M5B backup before ${EVENT_BATCH_MIGRATION_ID}: ${backup.backupDir}`)
}

function createPreviewVerifiedBackup(options: {
  database: Database.Database
  dataDir: string
  actionLogPath: string
}): void {
  const backup = createVerifiedMigrationBackup({
    source: {
      checkpointFull: () => options.database.pragma('wal_checkpoint(FULL)'),
      vacuumInto: (path) => options.database.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`),
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
    dataDir: options.dataDir,
    actionLogPath: options.actionLogPath,
    stage: 'PREVIEW',
    migrationId: PREVIEW_CONTRACT_MIGRATION_ID
  })
  console.log(`[DB] Paired PREVIEW backup before ${PREVIEW_CONTRACT_MIGRATION_ID}: ${backup.backupDir}`)
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
