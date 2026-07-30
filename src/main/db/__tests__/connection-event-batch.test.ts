import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { EVENT_BATCH_MIGRATION_ID } from '../event-batch-migration'
import { MemoryAdapter } from '../memory-adapter'

const databases: MemoryAdapter[] = []
const schema = readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8')

async function m4Database(): Promise<MemoryAdapter> {
  const database = await MemoryAdapter.create()
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
  databases.push(database)
  return database
}

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close()
})

describe('connection M5B event-batch cutover', () => {
  it('builds a fresh v2.2 target without requesting a historical backup', async () => {
    const { runConnectionEventBatchCutover } = await import('../connection')
    const database = await MemoryAdapter.create()
    databases.push(database)
    const calls: string[] = []

    const result = runConnectionEventBatchCutover({
      adapter: database,
      fresh: true,
      loadTargetSchema: () => {
        calls.push('schema')
        database.exec(schema)
      },
      reconcileHistorical: () => calls.push('reconcile'),
      createVerifiedBackup: () => calls.push('backup')
    })

    expect(result).toEqual({ source: 'ALREADY_TARGET', applied: false })
    expect(calls).toEqual(['schema'])
  })

  it('reconciles and backs up exact M4 before creating any v2 event-batch object', async () => {
    const { runConnectionEventBatchCutover } = await import('../connection')
    const database = await m4Database()
    const calls: string[] = []

    const result = runConnectionEventBatchCutover({
      adapter: database,
      fresh: false,
      loadTargetSchema: () => {
        calls.push('schema')
        database.exec(schema)
      },
      reconcileHistorical: () => calls.push('reconcile'),
      createVerifiedBackup: () => {
        calls.push('backup')
        expect(database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'command_log'").get())
          .toBeUndefined()
      }
    })

    expect(result).toEqual({ source: 'EXACT_M4', applied: true })
    expect(calls).toEqual(['reconcile', 'backup', 'schema'])
  })
})
