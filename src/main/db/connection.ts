import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { readFileSync, mkdirSync } from 'fs'
import { hashPassword } from '../utils/password'

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

  seedDevUsers(db)

  console.log(`[DB] Ready: ${dbPath}`)
}

function seedDevUsers(database: Database.Database): void {
  const count = database
    .prepare('SELECT COUNT(*) as c FROM user_account')
    .get() as { c: number }
  if (count.c > 0) return

  const hash = hashPassword('123456')
  const tx = database.transaction(() => {
    database.prepare(`
      INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
      VALUES
        ('seed-teacher-001', 'teacher', ?, 'TEACHER', '张老师', 'ACTIVE'),
        ('seed-student-001', 'student', ?, 'STUDENT', '李同学', 'ACTIVE'),
        ('seed-admin-001',   'admin',   ?, 'ADMIN',   '系统管理员', 'ACTIVE')
    `).run(hash, hash, hash)

    database.prepare(`
      INSERT INTO student_profile (student_id, student_name, gender, birth_date, guardian_contact, sensory_profile_json, status)
      VALUES ('seed-student-001', '李同学', NULL, NULL, NULL, NULL, 'ACTIVE')
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
