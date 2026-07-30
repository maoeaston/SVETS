import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'

import type { DBAdapter } from '../../src/main/db/interface'
import {
  applyEventBatchMigration,
  assertExactEventBatchStructure,
  EVENT_BATCH_MIGRATION_ID,
  EVENT_BATCH_SCHEMA_VERSION,
  inspectEventBatchStructure
} from '../../src/main/db/event-batch-migration'

const root = mkdtempSync(join(tmpdir(), 'svets-m5b-native-'))
const dbPath = join(root, 'xc-career-guide.db')
const backupPath = join(root, 'pre-m5b-xc-career-guide.db')
const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function asAdapter(database: Database.Database): DBAdapter {
  return {
    prepare: database.prepare.bind(database),
    exec: database.exec.bind(database),
    transaction: (fn) => database.transaction(fn),
    immediateTransaction: (fn) => {
      const transaction = database.transaction(fn)
      return () => transaction.immediate()
    }
  } as unknown as DBAdapter
}

try {
  const database = new Database(dbPath)
  try {
    database.pragma('journal_mode = DELETE')
    database.pragma('foreign_keys = ON')
    database.exec(schema)
    database.exec(`
      DROP INDEX IF EXISTS ux_command_idempotency;
      DROP INDEX IF EXISTS idx_applied_event_batch_segment;
      DROP INDEX IF EXISTS idx_processed_event_batch;
      DROP TABLE IF EXISTS processed_event;
      DROP TABLE IF EXISTS applied_event_batch;
      DROP TABLE IF EXISTS projector_cursor;
      DROP TABLE IF EXISTS command_log;
    `)
    database.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(EVENT_BATCH_MIGRATION_ID)
    writeFileSync(join(root, 'action_log.jsonl'), '{"event":"m5b-native-history"}\n', 'utf8')
    const adapter = asAdapter(database)
    assert(inspectEventBatchStructure(adapter) === 'ABSENT', 'native fixture is not exact M4')

    let backedUp = false
    const result = applyEventBatchMigration(adapter, {
      createVerifiedBackupBeforeDdl: () => {
        assert(inspectEventBatchStructure(adapter) === 'ABSENT', 'backup occurred after v2 DDL')
        database.pragma('wal_checkpoint(FULL)')
        copyFileSync(dbPath, backupPath)
        backedUp = true
      }
    })
    assert(result.source === 'EXACT_M4' && result.applied, `unexpected migration result ${JSON.stringify(result)}`)
    assert(backedUp, 'native migration omitted paired pre-DDL backup')
    assertExactEventBatchStructure(adapter)
    const ledger = database.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?')
      .get(EVENT_BATCH_MIGRATION_ID) as { schema_version?: string } | undefined
    assert(ledger?.schema_version === EVENT_BATCH_SCHEMA_VERSION, 'native migration ledger is absent')
  } finally {
    database.close()
  }

  const reopened = new Database(dbPath, { readonly: true })
  try {
    assertExactEventBatchStructure(asAdapter(reopened))
    assert(reopened.prepare('PRAGMA integrity_check').pluck().get() === 'ok', 'native target integrity check failed')
  } finally {
    reopened.close()
  }
  console.log('[db:m5b:native:verify] PASS source=EXACT_M4 target=0.1.18-event-batch-v2.2 backup=verified')
} finally {
  rmSync(root, { recursive: true, force: true })
}
