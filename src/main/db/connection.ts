import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { app } from 'electron'
import { copyFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { hashPassword } from '../utils/password'
import devAccounts from '../../shared/config/dev-accounts.json'
import type { DBAdapter } from './interface'
import { getActionLogPath } from '../domain/action-log-path'
import { writeEvent } from '../domain/event-writer'
import { reconcileActionLog, writeRecoverySnapshot } from '../domain/recovery'
import {
  assertCurrentDatabaseSchema,
  isFreshDatabase,
  runDatabaseMigrations
} from './migrations'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('[DB] Not initialized — call initDatabase() first')
  }
  return db
}

export function initDatabase(): void {
  const dataDir = join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })

  const dbPath = join(dataDir, 'xc-career-guide.db')
  const database = new Database(dbPath)

  try {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')

    const schemaPath = join(__dirname, 'schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    const adapter = database as unknown as DBAdapter
    const fresh = isFreshDatabase(adapter)
    const migrated = runDatabaseMigrations(adapter, {
      beforeMigrate: (migrationIds) => {
        const backupPath = createMigrationBackup(database, dataDir)
        console.log(`[DB] Backup before ${migrationIds.join(', ')}: ${backupPath}`)
      }
    })

    database.transaction(() => database.exec(schema))()
    assertCurrentDatabaseSchema(adapter)
    seedDevUsers(database)
    db = database
    const recovery = recoverActionLog(database, dbPath)

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

function recoverActionLog(database: Database.Database, dbPath: string): {
  replayedEventCount: number
  skippedEventCount: number
  truncatedTail: boolean
} {
  const actionLogPath = getActionLogPath()
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
      actorRole: 'SYSTEM'
    })
    writeRecoverySnapshot(database as unknown as DBAdapter, {
      lastAppliedEvent: recoveryEvent,
      sqliteFileHash,
      actionLogPath,
      archivedLogPath: recovery.archivedTailPath,
      schemaVersion: '0.1.15-multi-device-m3-grant-assignment',
      appVersion: app.getVersion()
    })
  })()

  return recovery
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

function createMigrationBackup(database: Database.Database, dataDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(dataDir, 'backups', `pre-migration.${timestamp}`)
  mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, 'xc-career-guide.db')
  database.pragma('wal_checkpoint(FULL)')
  database.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
  const actionLogPath = join(dataDir, 'action_log.jsonl')
  if (existsSync(actionLogPath)) copyFileSync(actionLogPath, join(backupDir, 'action_log.jsonl'))
  return backupDir
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    console.log('[DB] Closed')
  }
}
