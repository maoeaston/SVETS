import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatRuntimeReadOnlyMessage } from '../../stores/runtime-health'

describe('runtime health banner', () => {
  it('exposes a stable, operator-safe read-only message', () => {
    expect(formatRuntimeReadOnlyMessage({
      schemaVersion: 'runtime-health-v1',
      state: 'CORRUPTION_READ_ONLY',
      blockingCode: 'STARTUP_RECOVERY_FAILED',
      evidenceDigest: 'digest',
      detectedAt: '2026-07-30T00:00:00.000Z',
      legacyRecordCount: 0
    })).toBe('写入操作已暂停（STARTUP_RECOVERY_FAILED）。')
  })

  it('renders only for the explicit corruption read-only state', () => {
    const source = readFileSync(new URL('../runtime-health-banner.vue', import.meta.url), 'utf8')
    expect(source).toContain("props.health?.state === 'CORRUPTION_READ_ONLY'")
    expect(source).toContain('role="alert"')
  })
})
