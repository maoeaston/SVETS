import type { DBAdapter } from './interface'
import {
  assertPreF7DatabaseSchema,
  assertPreM4DatabaseSchema,
  F6_SCORE_SCOPE_REQUIRED_MIGRATION_ID,
  F7_REPORT_FRAMEWORK_MIGRATION_ID,
  isFreshDatabase,
  M4_SAFETY_REKEY_MIGRATION_ID,
  runDatabaseMigrations
} from './migrations'
import {
  inspectM4SafetyRekeyStructure,
  M4SafetyRekeyMigrationError,
  preflightM4SafetyRekeyHistory
} from './safety-rekey-migration'
import { isF7ReportFrameworkStructurallyApplied } from './report-migration'

export type MigrationBackupStage = 'F7' | 'M4' | 'M5B' | 'PREVIEW'

export type DatabaseStartupUpgradeDependencies = {
  preReconcileF7: () => void
  createVerifiedBackup: (stage: MigrationBackupStage, migrationId: string) => void
  runMigrations?: typeof runDatabaseMigrations
}

export class DatabaseStartupUpgradeError extends Error {
  constructor(
    public readonly code: 'F7_MIGRATION_FAILED' | 'M4_MIGRATION_FAILED' | 'M4_SCHEMA_DRIFT',
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'DatabaseStartupUpgradeError'
  }
}

function runM4StartupPreparation(action: () => void): void {
  try {
    action()
  } catch (error) {
    if (error instanceof DatabaseStartupUpgradeError) throw error
    const code = error instanceof M4SafetyRekeyMigrationError && error.code === 'M4_SCHEMA_DRIFT'
      ? 'M4_SCHEMA_DRIFT'
      : 'M4_MIGRATION_FAILED'
    throw new DatabaseStartupUpgradeError(code, 'M4 database startup preparation failed safely', error)
  }
}

function hasMigrationLedger(database: DBAdapter, migrationId: string): boolean {
  const row = database.prepare('SELECT 1 AS present FROM schema_migration WHERE migration_id = ?')
    .get(migrationId) as { present: number } | undefined
  return Boolean(row)
}

/**
 * Applies only the non-fresh startup bridge. Fresh databases load the current schema
 * atomically afterwards, while upgraded databases must never let that load mask a
 * missing ledger or a safety-object drift.
 */
export function orchestrateDatabaseStartupUpgrade(
  database: DBAdapter,
  dependencies: DatabaseStartupUpgradeDependencies
): string[] {
  if (isFreshDatabase(database)) return []

  const run = dependencies.runMigrations ?? runDatabaseMigrations
  const migrated: string[] = []
  if (!isF7ReportFrameworkStructurallyApplied(database)) {
    migrated.push(...run(database, { throughMigrationId: F6_SCORE_SCOPE_REQUIRED_MIGRATION_ID }))
    assertPreF7DatabaseSchema(database)
    dependencies.preReconcileF7()
    dependencies.createVerifiedBackup('F7', F7_REPORT_FRAMEWORK_MIGRATION_ID)
    try {
      migrated.push(...run(database, { throughMigrationId: F7_REPORT_FRAMEWORK_MIGRATION_ID }))
    } catch (error) {
      throw new DatabaseStartupUpgradeError('F7_MIGRATION_FAILED', 'F7 database migration failed safely', error)
    }
  } else if (!hasMigrationLedger(database, F7_REPORT_FRAMEWORK_MIGRATION_ID)) {
    try {
      migrated.push(...run(database, { throughMigrationId: F7_REPORT_FRAMEWORK_MIGRATION_ID }))
    } catch (error) {
      throw new DatabaseStartupUpgradeError('F7_MIGRATION_FAILED', 'F7 database ledger reconciliation failed safely', error)
    }
  }

  assertPreM4DatabaseSchema(database)
  const m4State = inspectM4SafetyRekeyStructure(database)
  const hasM4Ledger = hasMigrationLedger(database, M4_SAFETY_REKEY_MIGRATION_ID)
  if (m4State === 'LEGACY_V016') {
    if (hasM4Ledger) {
      throw new DatabaseStartupUpgradeError(
        'M4_SCHEMA_DRIFT',
        'M4 migration ledger conflicts with legacy safety structure; startup stopped before backup or DDL',
        new M4SafetyRekeyMigrationError('M4_SCHEMA_DRIFT', 'M4 ledger exists while legacy safety objects remain')
      )
    }
    runM4StartupPreparation(() => {
      preflightM4SafetyRekeyHistory(database)
      dependencies.createVerifiedBackup('M4', M4_SAFETY_REKEY_MIGRATION_ID)
      migrated.push(...run(database, { throughMigrationId: M4_SAFETY_REKEY_MIGRATION_ID }))
    })
  } else if (m4State === 'CURRENT_M4') {
    if (!hasM4Ledger) {
      try {
        migrated.push(...run(database, { throughMigrationId: M4_SAFETY_REKEY_MIGRATION_ID }))
      } catch (error) {
        throw new DatabaseStartupUpgradeError('M4_MIGRATION_FAILED', 'M4 database ledger reconciliation failed safely', error)
      }
    }
  } else {
    throw new DatabaseStartupUpgradeError(
      'M4_SCHEMA_DRIFT',
      'M4 database safety structure is partial or drifted; startup stopped before DDL',
      new M4SafetyRekeyMigrationError('M4_SCHEMA_DRIFT', 'M4 partial or drifted safety structure')
    )
  }
  return migrated
}
