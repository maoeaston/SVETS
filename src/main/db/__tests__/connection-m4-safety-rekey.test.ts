import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { MemoryAdapter } from '../memory-adapter'
import { M4_SAFETY_REKEY_MIGRATION_ID } from '../migrations'
import { inspectM4SafetyRekeyStructure } from '../safety-rekey-migration'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/svets-test-user-data',
    getVersion: () => 'test'
  }
}))

vi.mock('better-sqlite3', () => ({
  default: class Database {}
}))

const V016_SAFETY_OBJECTS_FIXTURE = readFileSync(
  resolve(process.cwd(), 'src/main/db/__tests__/fixtures/m4-v016-safety-objects.sql'),
  'utf8'
)

const CURRENT_M4_OBJECTS: ReadonlyArray<readonly ['index' | 'trigger', string]> = [
  ['trigger', 'trg_assessment_session_redline_incident_same_student_job_task_insert'],
  ['trigger', 'trg_assessment_session_redline_incident_same_student_job_task_update'],
  ['trigger', 'trg_training_session_redline_incident_same_student_job_task_insert'],
  ['trigger', 'trg_training_session_redline_incident_same_student_job_task_update'],
  ['trigger', 'trg_assessment_session_block_unresolved_safety_incident'],
  ['trigger', 'trg_training_session_block_unresolved_safety_incident'],
  ['trigger', 'trg_safety_incident_replacement_same_student_job_task_insert'],
  ['trigger', 'trg_safety_incident_replacement_same_student_job_task_update'],
  ['trigger', 'trg_safety_incident_bind_open_assessments'],
  ['trigger', 'trg_safety_incident_bind_open_trainings'],
  ['index', 'idx_assessment_session_student_job_task_status'],
  ['index', 'ux_assessment_one_open_session_per_student_job_task_strategy'],
  ['index', 'idx_training_session_student_job_task_status'],
  ['index', 'ux_training_one_open_session_per_student_job_task'],
  ['index', 'idx_safety_incident_student_job_task_status']
]

async function createV016Database(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
  for (const [type, name] of CURRENT_M4_OBJECTS) db.exec(`DROP ${type.toUpperCase()} ${name};`)
  db.exec(V016_SAFETY_OBJECTS_FIXTURE)
  db.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(M4_SAFETY_REKEY_MIGRATION_ID)
  return db
}

describe('connection M4 startup bridge', () => {
  it('runs the M4 preflight and paired-backup branch for a frozen v0.1.16 database', async () => {
    const { runConnectionStartupUpgrade } = await import('../connection')
    const db = await createV016Database()
    const calls: string[] = []

    const migrated = runConnectionStartupUpgrade({
      database: {} as never,
      adapter: db,
      dataDir: '/tmp/svets-unused-data-dir',
      actionLogPath: '/tmp/svets-unused-action-log.jsonl',
      dependencies: {
        preReconcileF7: () => calls.push('reconcile-f7'),
        createVerifiedBackup: (stage, migrationId) => calls.push(`backup:${stage}:${migrationId}`)
      }
    })

    expect(migrated).toEqual([M4_SAFETY_REKEY_MIGRATION_ID])
    expect(calls).toEqual([`backup:M4:${M4_SAFETY_REKEY_MIGRATION_ID}`])
    expect(inspectM4SafetyRekeyStructure(db)).toBe('CURRENT_M4')
    expect(db.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?').get(M4_SAFETY_REKEY_MIGRATION_ID))
      .toMatchObject({ present: 1 })
    db.close()
  })
})
