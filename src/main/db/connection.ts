import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { readFileSync, mkdirSync } from 'fs'

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
  db = new Database(dbPath)

  // WAL 模式提升并发读性能，外键约束在 schema.sql 中通过 PRAGMA 启用
  db.pragma('journal_mode = WAL')

  const schemaPath = join(__dirname, 'schema.sql')
  const schema = readFileSync(schemaPath, 'utf-8')
  db.exec(schema)

  console.log(`[DB] Ready: ${dbPath}`)
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    console.log('[DB] Closed')
  }
}
