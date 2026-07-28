import { describe, expect, it } from 'vitest'
import { describeStartupFailure, normalizeStartupUpgradeError } from '../startup-error'
import { DatabaseStartupUpgradeError } from '../db/migration-startup'
import { StartupRecoveryRequiredError } from '../domain/legacy-upgrade-recovery'

describe('startup error presentation', () => {
  it('keeps M4 preparation failures out of the generic Electron startup branch', () => {
    const cause = new Error('M4 history preflight failed: binding-key-mismatch:1')
    const normalized = normalizeStartupUpgradeError(new DatabaseStartupUpgradeError(
      'M4_MIGRATION_FAILED',
      'M4 database startup preparation failed safely',
      cause
    ))

    expect(normalized).toBeInstanceOf(StartupRecoveryRequiredError)
    expect(normalized).toMatchObject({ code: 'M4_MIGRATION_FAILED', cause })
    expect(describeStartupFailure(normalized)).toMatchObject({
      logMessage: '[startup] M4_MIGRATION_FAILED: M4 database startup preparation failed safely',
      title: '数据库需要恢复'
    })
  })

  it('uses the generic Electron startup branch only for unmapped errors', () => {
    expect(describeStartupFailure(new Error('unexpected'))).toMatchObject({
      logMessage: '[startup] Database initialization failed',
      title: '启动失败'
    })
  })
})
