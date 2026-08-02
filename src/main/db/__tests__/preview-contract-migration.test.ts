import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from '../test-helpers'
import {
  applyPreviewContractMigration,
  assertPreviewContractStructure,
  PREVIEW_CONTRACT_INDEX_NAMES,
  PREVIEW_CONTRACT_TABLE_NAMES,
  PREVIEW_CONTRACT_TRIGGER_NAMES,
  previewContractIntegrityIssues,
  inspectPreviewContractStructure,
  previewContractMigrationState,
  previewContractStructureDigest,
  PREVIEW_CONTRACT_SCHEMA_VERSION,
  promotePreviewContractReadyWithProvider
} from '../preview-contract-migration'
import { PREVIEW_CONTRACT_MIGRATION_ID } from '../../../shared/types/preview-contract'
import { EVENT_BATCH_MIGRATION_ID } from '../event-batch-migration'
import { previewContractReadiness } from '../../domain/preview/preview-ready-gate'
import { promotePreviewContractReady } from '../../domain/preview/preview-promotion'

const databases: Array<{ close: () => void }> = []

function removePreviewObjects(database: { exec: (sql: string) => void }): void {
  database.exec([
    ...PREVIEW_CONTRACT_TRIGGER_NAMES.map((name) => `DROP TRIGGER IF EXISTS ${name}`),
    ...PREVIEW_CONTRACT_INDEX_NAMES.map((name) => `DROP INDEX IF EXISTS ${name}`),
    ...[...PREVIEW_CONTRACT_TABLE_NAMES].reverse().map((name) => `DROP TABLE IF EXISTS ${name}`),
    `DELETE FROM schema_migration WHERE migration_id = '${PREVIEW_CONTRACT_MIGRATION_ID}'`
  ].join(';\n'))
}

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close()
})

describe('PREVIEW_CONTRACT_V1 additive migration', () => {
  it('accepts the authoritative fresh target without backup and keeps the registry INSTALLING', async () => {
    const database = await createTestDb()
    databases.push(database)

    expect(previewContractMigrationState(database)).toBe('CURRENT')
    expect(applyPreviewContractMigration(database, { fresh: true })).toEqual({
      source: 'ALREADY_TARGET',
      applied: false
    })
    assertPreviewContractStructure(database)
    expect(database.prepare(
      'SELECT status, schema_version, migration_id FROM preview_contract_registry WHERE registry_id = ?'
    ).get('PREVIEW_CONTRACT_V1')).toMatchObject({
      status: 'INSTALLING',
      schema_version: PREVIEW_CONTRACT_SCHEMA_VERSION,
      migration_id: PREVIEW_CONTRACT_MIGRATION_ID
    })
  })

  it('installs from an exact M5B database only after the paired backup callback', async () => {
    const database = await createTestDb()
    databases.push(database)
    removePreviewObjects(database)
    const calls: string[] = []

    expect(previewContractMigrationState(database)).toBe('ABSENT')
    expect(() => applyPreviewContractMigration(database)).toThrow(/verified DB\/action-log pair/)
    expect(applyPreviewContractMigration(database, {
      fresh: false,
      createVerifiedBackupBeforeDdl: () => calls.push('backup')
    })).toEqual({ source: 'EXACT_M5B', applied: true })
    expect(calls).toEqual(['backup'])
    expect(previewContractMigrationState(database)).toBe('CURRENT')
    assertPreviewContractStructure(database)
    expect(database.prepare(
      'SELECT schema_version FROM schema_migration WHERE migration_id = ?'
    ).get(EVENT_BATCH_MIGRATION_ID)).toMatchObject({ schema_version: '0.1.18-event-batch-v2.2' })
    expect(database.prepare(
      'SELECT schema_version FROM schema_migration WHERE migration_id = ?'
    ).get(PREVIEW_CONTRACT_MIGRATION_ID)).toMatchObject({ schema_version: PREVIEW_CONTRACT_SCHEMA_VERSION })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
  })

  it('promotes only a complete application registry and persists its digest evidence', async () => {
    const database = await createTestDb()
    databases.push(database)
    const readiness = previewContractReadiness('READY')

    promotePreviewContractReady(database, '2026-08-01T01:00:00.000Z')

    expect(database.prepare(
      'SELECT status, event_registry_digest, projection_digest, query_digest, recovery_digest, error_map_digest, installed_at FROM preview_contract_registry WHERE registry_id = ?'
    ).get('PREVIEW_CONTRACT_V1')).toMatchObject({
      status: 'READY',
      event_registry_digest: readiness.event_registry_digest,
      projection_digest: readiness.projection_digest,
      query_digest: readiness.query_digest,
      recovery_digest: readiness.recovery_digest,
      error_map_digest: readiness.error_map_digest,
      installed_at: '2026-08-01T01:00:00.000Z'
    })
  })

  it('does not promote when either migration ledger is missing even if objects remain', async () => {
    const database = await createTestDb()
    databases.push(database)
    const readiness = previewContractReadiness('READY')

    database.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(PREVIEW_CONTRACT_MIGRATION_ID)
    expect(previewContractMigrationState(database)).toBe('INSTALLING')
    expect(() => promotePreviewContractReadyWithProvider(database, () => readiness, '2026-08-01T01:00:00.000Z'))
      .toThrowError(expect.objectContaining({ code: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' }))

    database.prepare(
      'INSERT INTO schema_migration (migration_id, schema_version, description) VALUES (?, ?, ?)'
    ).run(PREVIEW_CONTRACT_MIGRATION_ID, PREVIEW_CONTRACT_SCHEMA_VERSION, 'restore preview ledger')
    database.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(EVENT_BATCH_MIGRATION_ID)
    expect(previewContractMigrationState(database)).toBe('PARTIAL_OR_DRIFTED')
    expect(() => promotePreviewContractReadyWithProvider(database, () => readiness, '2026-08-01T01:00:00.000Z'))
      .toThrowError(expect.objectContaining({ code: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED' }))
  })

  it('audits columns, indexes, and trigger semantics instead of only object names', async () => {
    const database = await createTestDb()
    databases.push(database)

    database.exec('ALTER TABLE preview_session_projection ADD COLUMN drifted_column TEXT')
    database.exec('DROP INDEX idx_preview_session_status')
    database.exec(
      'CREATE INDEX idx_preview_session_status ON preview_session_projection(status)'
    )
    database.exec('DROP TRIGGER trg_preview_safety_scope')
    database.exec(`
      CREATE TRIGGER trg_preview_safety_scope
      BEFORE INSERT ON preview_safety_incident_projection
      FOR EACH ROW
      BEGIN SELECT RAISE(ABORT, 'incorrect safety scope'); END
    `)

    const issues = inspectPreviewContractStructure(database)
    expect(issues).toEqual(expect.arrayContaining([
      'columns:preview_session_projection',
      'columns:index:idx_preview_session_status',
      'sql:index:idx_preview_session_status',
      expect.stringContaining('trigger-sql:trg_preview_safety_scope:')
    ]))
    expect(previewContractMigrationState(database)).toBe('PARTIAL_OR_DRIFTED')
  })

  it('has a stable structure digest across fresh and migrated isolated schemas', async () => {
    const database = await createTestDb()
    databases.push(database)
    const freshDigest = previewContractStructureDigest(database)

    removePreviewObjects(database)
    applyPreviewContractMigration(database, {
      fresh: false,
      createVerifiedBackupBeforeDdl: () => undefined
    })

    expect(previewContractStructureDigest(database)).toBe(freshDigest)
  })

  it('does not promote a structurally current database with broken foreign-key data', async () => {
    const database = await createTestDb()
    databases.push(database)
    const readiness = previewContractReadiness('READY')

    database.exec('PRAGMA foreign_keys = OFF')
    database.prepare(`
      INSERT INTO preview_event_projection (
        event_id, contract_registry_id, aggregate_type, aggregate_id, event_type,
        event_sequence, payload_json, checksum, source_batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'orphan-preview-event',
      'PREVIEW_CONTRACT_V1',
      'PREVIEW_RELEASE',
      'orphan-release',
      'PREVIEW_PACK_RELEASED',
      1,
      '{}',
      'a'.repeat(64),
      'missing-batch'
    )

    expect(previewContractIntegrityIssues(database)).toEqual(['foreign-key-check:1'])
    expect(() => promotePreviewContractReadyWithProvider(database, () => readiness, '2026-08-01T01:00:00.000Z'))
      .toThrowError(expect.objectContaining({ code: 'PREVIEW_CONTRACT_INTEGRITY_FAILED' }))
  })
})
