import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createVerifiedMigrationBackup } from '../migration-backup'
import { M4_SAFETY_REKEY_MIGRATION_ID } from '../migrations'

const temporaryRoots: string[] = []

function temporaryBackupSource(verifyCalls: string[]) {
  return {
    checkpointFull: () => undefined,
    vacuumInto: (path: string) => {
      writeFileSync(path, 'temporary SQLite backup fixture', 'utf8')
    },
    verifyBackup: (path: string) => {
      verifyCalls.push(path)
      expect(readFileSync(path, 'utf8')).toBe('temporary SQLite backup fixture')
    }
  }
}

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
})

describe('stage-specific migration backup', () => {
  it('writes a verified M4 DB/action-log pair and manifest under an explicit temporary root', () => {
    const root = mkdtempSync(join(tmpdir(), 'xc-m4-backup-test-'))
    temporaryRoots.push(root)
    const dataDir = join(root, 'data')
    const actionLogPath = join(dataDir, 'action_log.jsonl')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(actionLogPath, '{"event":"preserved"}\n', 'utf8')
    const verifyCalls: string[] = []

    const backup = createVerifiedMigrationBackup({
      source: temporaryBackupSource(verifyCalls),
      dataDir,
      actionLogPath,
      stage: 'M4',
      migrationId: M4_SAFETY_REKEY_MIGRATION_ID,
      now: new Date('2026-07-27T00:00:00.000Z')
    })

    const manifest = JSON.parse(readFileSync(backup.manifestPath, 'utf8'))
    expect(backup.backupDir).toContain('pre-migration.m4.')
    expect(manifest).toMatchObject({
      stage: 'M4',
      migration_id: M4_SAFETY_REKEY_MIGRATION_ID,
      database: { integrity_check: 'ok' },
      action_log: { status: 'PRESENT' }
    })
    expect(readFileSync(join(backup.backupDir, 'action_log.jsonl'), 'utf8')).toBe('{"event":"preserved"}\n')
    expect(verifyCalls).toEqual([join(backup.backupDir, 'xc-career-guide.db')])
  })

  it('records an absent action log without inventing a copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'xc-m4-backup-test-'))
    temporaryRoots.push(root)
    const dataDir = join(root, 'data')
    mkdirSync(dataDir, { recursive: true })
    const verifyCalls: string[] = []

    const backup = createVerifiedMigrationBackup({
      source: temporaryBackupSource(verifyCalls),
      dataDir,
      actionLogPath: join(dataDir, 'action_log.jsonl'),
      stage: 'F7',
      migrationId: '2026-07-24_f7_report_framework',
      now: new Date('2026-07-27T00:00:01.000Z')
    })

    expect(JSON.parse(readFileSync(backup.manifestPath, 'utf8')).action_log).toEqual({
      status: 'ABSENT', file: null, sha256: null
    })
    expect(verifyCalls).toEqual([join(backup.backupDir, 'xc-career-guide.db')])
  })

  it('preserves an existing M4 backup when its timestamped directory conflicts', () => {
    const root = mkdtempSync(join(tmpdir(), 'xc-m4-backup-test-'))
    temporaryRoots.push(root)
    const dataDir = join(root, 'data')
    const timestamp = '2026-07-27T00-00-02-000Z'
    const backupDir = join(dataDir, 'backups', `pre-migration.m4.${timestamp}`)
    const preservedMarkerPath = join(backupDir, 'preserved-backup-marker')
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(preservedMarkerPath, 'do not relabel existing backup', 'utf8')
    const calls: string[] = []

    expect(() => createVerifiedMigrationBackup({
      source: {
        checkpointFull: () => calls.push('checkpoint'),
        vacuumInto: () => calls.push('vacuum'),
        verifyBackup: () => calls.push('verify')
      },
      dataDir,
      actionLogPath: join(dataDir, 'action_log.jsonl'),
      stage: 'M4',
      migrationId: M4_SAFETY_REKEY_MIGRATION_ID,
      now: new Date('2026-07-27T00:00:02.000Z')
    })).toThrow(/EEXIST/)

    expect(calls).toEqual([])
    expect(readFileSync(preservedMarkerPath, 'utf8')).toBe('do not relabel existing backup')
    expect(existsSync(backupDir)).toBe(true)
    expect(existsSync(`${backupDir}.INCOMPLETE`)).toBe(false)
  })

  it('isolates only the backup directory created by a failing invocation', () => {
    const root = mkdtempSync(join(tmpdir(), 'xc-m4-backup-test-'))
    temporaryRoots.push(root)
    const dataDir = join(root, 'data')
    const timestamp = '2026-07-27T00-00-03-000Z'
    const backupDir = join(dataDir, 'backups', `pre-migration.m4.${timestamp}`)
    const incompleteDir = `${backupDir}.INCOMPLETE`

    expect(() => createVerifiedMigrationBackup({
      source: {
        checkpointFull: () => undefined,
        vacuumInto: (path: string) => {
          writeFileSync(path, 'partial SQLite backup fixture', 'utf8')
          throw new Error('simulated backup failure')
        },
        verifyBackup: () => undefined
      },
      dataDir,
      actionLogPath: join(dataDir, 'action_log.jsonl'),
      stage: 'M4',
      migrationId: M4_SAFETY_REKEY_MIGRATION_ID,
      now: new Date('2026-07-27T00:00:03.000Z')
    })).toThrow('simulated backup failure')

    expect(existsSync(backupDir)).toBe(false)
    expect(readFileSync(join(incompleteDir, 'xc-career-guide.db'), 'utf8')).toBe('partial SQLite backup fixture')
  })
})
