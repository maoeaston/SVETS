import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyEventBatchMigration,
  assertExactEventBatchStructure,
  EVENT_BATCH_MIGRATION_ID,
  EVENT_BATCH_SCHEMA_SQL,
  EVENT_BATCH_SCHEMA_VERSION,
  EventBatchMigrationError,
  eventBatchStructureIssues,
  inspectEventBatchStructure,
  preflightEventBatchMigration
} from '../event-batch-migration'
import type { DBAdapter, DBStatement } from '../interface'
import { MemoryAdapter } from '../memory-adapter'
import { SqliteAdapter } from '../sqlite-adapter'
import { createTestDb } from '../test-helpers'
import {
  PREVIEW_CONTRACT_INDEX_NAMES,
  PREVIEW_CONTRACT_TABLE_NAMES,
  PREVIEW_CONTRACT_TRIGGER_NAMES
} from '../preview-contract-migration'

const databases: MemoryAdapter[] = []

async function freshDatabase(): Promise<MemoryAdapter> {
  const database = await MemoryAdapter.create()
  database.exec('PRAGMA foreign_keys = ON;')
  databases.push(database)
  return database
}

async function m4Database(): Promise<MemoryAdapter> {
  const database = await createTestDb()
  database.exec([
    ...PREVIEW_CONTRACT_TRIGGER_NAMES.map((name) => `DROP TRIGGER IF EXISTS ${name}`),
    ...PREVIEW_CONTRACT_INDEX_NAMES.map((name) => `DROP INDEX IF EXISTS ${name}`),
    ...[...PREVIEW_CONTRACT_TABLE_NAMES].reverse().map((name) => `DROP TABLE IF EXISTS ${name}`),
    "DELETE FROM schema_migration WHERE migration_id = '2026-08-01_job_skill_preview_contract_v1'"
  ].join(';\n'))
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
  databases.push(database)
  return database
}

function count(database: DBAdapter, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count
}

class FailEventBatchLedgerInsertAdapter implements DBAdapter {
  constructor(private readonly delegate: DBAdapter) {}

  prepare(sql: string): DBStatement {
    const statement = this.delegate.prepare(sql)
    if (!sql.toUpperCase().includes('INSERT INTO SCHEMA_MIGRATION')) return statement
    return {
      run: (...params: unknown[]) => {
        if (params[0] === EVENT_BATCH_MIGRATION_ID) throw new Error('injected M5B ledger failure')
        return statement.run(...params)
      },
      get: statement.get,
      all: statement.all
    }
  }

  transaction<T>(fn: () => T): () => T {
    return this.delegate.transaction(fn)
  }

  immediateTransaction<T>(fn: () => T): () => T {
    return this.delegate.immediateTransaction(fn)
  }

  exec(sql: string): void {
    this.delegate.exec(sql)
  }
}

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close()
})

describe('M5B event-batch migration kernel', () => {
  it('migrates a truly empty database without requesting a historical backup', async () => {
    const database = await freshDatabase()
    let backupCalls = 0

    expect(preflightEventBatchMigration(database)).toBe('FRESH')
    expect(applyEventBatchMigration(database, {
      createVerifiedBackupBeforeDdl: () => { backupCalls += 1 }
    })).toEqual({ source: 'FRESH', applied: true })

    expect(backupCalls).toBe(0)
    expect(inspectEventBatchStructure(database)).toBe('CURRENT')
    expect(database.prepare('SELECT schema_version FROM schema_migration WHERE migration_id = ?')
      .get(EVENT_BATCH_MIGRATION_ID)).toMatchObject({ schema_version: EVENT_BATCH_SCHEMA_VERSION })
    assertExactEventBatchStructure(database)
  })

  it('accepts only exact M4 history, runs backup before DDL, and is idempotent at the exact target', async () => {
    const database = await m4Database()
    const calls: string[] = []
    const migration = () => applyEventBatchMigration(database, {
      createVerifiedBackupBeforeDdl: () => {
        calls.push('backup')
        expect(inspectEventBatchStructure(database)).toBe('ABSENT')
        expect(count(database, "SELECT COUNT(*) AS count FROM schema_migration WHERE migration_id = '2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey'"))
          .toBe(1)
      }
    })

    expect(preflightEventBatchMigration(database)).toBe('EXACT_M4')
    expect(migration()).toEqual({ source: 'EXACT_M4', applied: true })
    expect(calls).toEqual(['backup'])
    expect(migration()).toEqual({ source: 'ALREADY_TARGET', applied: false })
    expect(calls).toEqual(['backup'])
    expect(count(database, 'SELECT COUNT(*) AS count FROM schema_migration')).toBe(9)
  })

  it('recognizes the authoritative fresh schema as an already complete v2.2 target', async () => {
    const database = await createTestDb()
    databases.push(database)

    expect(preflightEventBatchMigration(database)).toBe('ALREADY_TARGET')
    expect(applyEventBatchMigration(database)).toEqual({ source: 'ALREADY_TARGET', applied: false })
    assertExactEventBatchStructure(database)
  })

  it('creates exactly T11-T14 and their three named indexes, without later v2.2 tables', async () => {
    const database = await freshDatabase()
    applyEventBatchMigration(database)

    const objects = database.prepare(
      "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).all() as Array<{ type: string; name: string }>
    expect(objects).toEqual([
      { type: 'index', name: 'idx_applied_event_batch_segment' },
      { type: 'index', name: 'idx_processed_event_batch' },
      { type: 'index', name: 'ux_command_idempotency' },
      { type: 'table', name: 'applied_event_batch' },
      { type: 'table', name: 'command_log' },
      { type: 'table', name: 'processed_event' },
      { type: 'table', name: 'projector_cursor' },
      { type: 'table', name: 'schema_migration' }
    ])
    expect(eventBatchStructureIssues(database)).toEqual([])
    expect(EVENT_BATCH_SCHEMA_SQL).not.toMatch(/backup_manifest|offline_score_draft|pairing_challenge/)
  })

  it('enforces JSON, status, event count, FK, and uniqueness constraints', async () => {
    const database = await freshDatabase()
    applyEventBatchMigration(database)

    database.prepare(`
      INSERT INTO command_log
        (command_id, idempotency_key, client_instance_id, command_type, actor_id, request_hash)
      VALUES ('command-1', 'key-1', 'client-1', 'training:startStep', 'teacher-1', 'hash-1')
    `).run()
    expect(() => database.prepare(`
      INSERT INTO command_log
        (command_id, idempotency_key, client_instance_id, command_type, actor_id, request_hash)
      VALUES ('command-2', 'key-1', 'client-1', 'training:startStep', 'teacher-1', 'hash-2')
    `).run()).toThrow()
    expect(() => database.prepare(`
      INSERT INTO command_log
        (command_id, idempotency_key, client_instance_id, command_type, actor_id, request_hash, result_json)
      VALUES ('command-json', 'key-json', 'client-1', 'training:startStep', 'teacher-1', 'hash-json', '{bad')
    `).run()).toThrow()
    expect(() => database.prepare(`
      INSERT INTO command_log
        (command_id, idempotency_key, client_instance_id, command_type, actor_id, request_hash, status)
      VALUES ('command-status', 'key-status', 'client-1', 'training:startStep', 'teacher-1', 'hash-status', 'UNKNOWN')
    `).run()).toThrow()
    expect(() => database.prepare(`
      INSERT INTO applied_event_batch
        (batch_id, batch_sequence, segment_id, event_count, previous_batch_hash, events_hash,
         batch_hash, jsonl_offset_start, jsonl_offset_end)
      VALUES ('batch-zero', 1, 'segment-1', 0, 'prev', 'events', 'batch', 0, 1)
    `).run()).toThrow()

    database.prepare(`
      INSERT INTO applied_event_batch
        (batch_id, batch_sequence, segment_id, command_id, event_count, previous_batch_hash,
         events_hash, batch_hash, jsonl_offset_start, jsonl_offset_end)
      VALUES ('batch-1', 1, 'segment-1', 'command-1', 1, 'prev', 'events', 'batch', 0, 100)
    `).run()
    expect(() => database.prepare(`
      INSERT INTO applied_event_batch
        (batch_id, batch_sequence, segment_id, event_count, previous_batch_hash, events_hash,
         batch_hash, jsonl_offset_start, jsonl_offset_end)
      VALUES ('batch-2', 1, 'segment-1', 1, 'prev-2', 'events-2', 'batch-2', 100, 200)
    `).run()).toThrow()
    expect(() => database.prepare(`
      INSERT INTO processed_event (event_id, batch_id, event_type, aggregate_type, aggregate_id)
      VALUES ('event-orphan', 'missing-batch', 'TRAINING_STARTED', 'TRAINING_SESSION', 'session-1')
    `).run()).toThrow()
    expect(() => database.prepare("UPDATE applied_event_batch SET batch_status = 'UNKNOWN' WHERE batch_id = 'batch-1'").run())
      .toThrow()
  })

  it('uses the declared indexes for idempotency, segment scan, and batch event scan', async () => {
    const database = await freshDatabase()
    applyEventBatchMigration(database)

    const plans = [
      database.prepare("EXPLAIN QUERY PLAN SELECT * FROM command_log WHERE client_instance_id = 'client' AND idempotency_key = 'key'").all(),
      database.prepare("EXPLAIN QUERY PLAN SELECT * FROM applied_event_batch WHERE segment_id = 'segment' ORDER BY batch_sequence").all(),
      database.prepare("EXPLAIN QUERY PLAN SELECT * FROM processed_event WHERE batch_id = 'batch'").all()
    ].flat() as Array<Record<string, unknown>>
    const details = plans.map((row) => String(row.detail ?? '')).join('\n')
    expect(details).toContain('ux_command_idempotency')
    expect(details).toContain('idx_applied_event_batch_segment')
    expect(details).toContain('idx_processed_event_batch')
  })

  it('rejects partial, mixed, unknown-ledger, and ledgerless target states before backup or DDL', async () => {
    const partial = await freshDatabase()
    partial.exec('CREATE TABLE command_log (command_id TEXT PRIMARY KEY);')
    expect(() => applyEventBatchMigration(partial)).toThrowError(EventBatchMigrationError)
    expect(inspectEventBatchStructure(partial)).toBe('PARTIAL_OR_DRIFTED')

    const unknown = await m4Database()
    unknown.prepare(`
      INSERT INTO schema_migration (migration_id, schema_version, description)
      VALUES ('unknown-migration', '9.9.9', 'unsupported')
    `).run()
    let backupCalls = 0
    expect(() => applyEventBatchMigration(unknown, {
      createVerifiedBackupBeforeDdl: () => { backupCalls += 1 }
    })).toThrow(/exact v0\.1\.17 migration ledger/)
    expect(backupCalls).toBe(0)
    expect(inspectEventBatchStructure(unknown)).toBe('ABSENT')

    const extraObject = await m4Database()
    extraObject.exec('CREATE TABLE unsupported_extension (id TEXT PRIMARY KEY);')
    expect(() => applyEventBatchMigration(extraObject, {
      createVerifiedBackupBeforeDdl: () => { backupCalls += 1 }
    })).toThrow(/exact v0\.1\.17 object inventory/)
    expect(backupCalls).toBe(0)

    const mixed = await m4Database()
    mixed.exec('CREATE TABLE command_log (command_id TEXT PRIMARY KEY);')
    expect(() => applyEventBatchMigration(mixed, {
      createVerifiedBackupBeforeDdl: () => { backupCalls += 1 }
    })).toThrow(/partial or drifted/)
    expect(backupCalls).toBe(0)

    const ledgerless = await freshDatabase()
    applyEventBatchMigration(ledgerless)
    ledgerless.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(EVENT_BATCH_MIGRATION_ID)
    expect(() => preflightEventBatchMigration(ledgerless)).toThrow(/target migration ledger drifted/)
  })

  it('requires the paired-backup callback for M4 and rolls back every DDL object when ledger write fails', async () => {
    const missingBackup = await m4Database()
    expect(() => applyEventBatchMigration(missingBackup)).toThrow(/requires a verified paired backup/)
    expect(inspectEventBatchStructure(missingBackup)).toBe('ABSENT')

    const underlying = await m4Database()
    const failing = new FailEventBatchLedgerInsertAdapter(underlying)
    let backupCalls = 0
    expect(() => applyEventBatchMigration(failing, {
      createVerifiedBackupBeforeDdl: () => { backupCalls += 1 }
    })).toThrow('injected M5B ledger failure')
    expect(backupCalls).toBe(1)
    expect(inspectEventBatchStructure(underlying)).toBe('ABSENT')
    expect(count(underlying, `SELECT COUNT(*) AS count FROM schema_migration WHERE migration_id = '${EVENT_BATCH_MIGRATION_ID}'`))
      .toBe(0)
  })

  it('implements explicit rollback and rejects nested BEGIN IMMEDIATE transactions', async () => {
    const database = await freshDatabase()
    database.exec('CREATE TABLE transaction_probe (id TEXT PRIMARY KEY);')

    expect(() => database.immediateTransaction(() => {
      database.prepare("INSERT INTO transaction_probe (id) VALUES ('rolled-back')").run()
      throw new Error('rollback probe')
    })()).toThrow('rollback probe')
    expect(count(database, 'SELECT COUNT(*) AS count FROM transaction_probe')).toBe(0)

    expect(() => database.transaction(() => {
      database.immediateTransaction(() => undefined)()
    })()).toThrow()
    expect(() => database.immediateTransaction(() => {
      database.immediateTransaction(() => undefined)()
    })()).toThrow()
  })

  it('dispatches the native adapter through better-sqlite3 immediate mode and fences nesting', () => {
    const immediate = vi.fn(() => 'native-result')
    const native = {
      inTransaction: false,
      transaction: vi.fn(() => ({ immediate }))
    }
    const adapter = new SqliteAdapter(native as never)
    const callback = vi.fn(() => 'callback-result')
    expect(adapter.immediateTransaction(callback)()).toBe('native-result')
    expect(native.transaction).toHaveBeenCalledWith(callback)
    expect(immediate).toHaveBeenCalledOnce()

    native.inTransaction = true
    expect(() => adapter.immediateTransaction(() => undefined)()).toThrow(/cannot be nested/)
  })

  it('activates the M5B target schema at the M5B-14 production boundary', () => {
    const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')
    const migrationRegistry = readFileSync(resolve(process.cwd(), 'src/main/db/migrations.ts'), 'utf8')

    expect(schema).toContain(EVENT_BATCH_MIGRATION_ID)
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS command_log')
    expect(migrationRegistry).not.toContain(EVENT_BATCH_MIGRATION_ID)
    expect(migrationRegistry).not.toContain("from './event-batch-migration'")
  })
})
