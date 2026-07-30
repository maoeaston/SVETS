import { existsSync } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  runCommandDifferential,
  type DifferentialSnapshot
} from './command-differential-harness'
import {
  createSyntheticHarness,
  SYNTHETIC_TIME
} from './coordinator-test-support'

const FROZEN_ORACLE_PATH = 'src/main/domain/recovery.ts'

function snapshot(infrastructureId: string): DifferentialSnapshot {
  return {
    publicResult: { success: true, projection_count: 1 },
    businessTables: {
      synthetic_projection: [{ aggregate_id: 'aggregate-1', value: 'stable' }]
    },
    events: [{
      eventType: 'SYNTHETIC_CHANGED',
      payload: {
        event_payload_version: 1,
        infrastructure_id: infrastructureId,
        value: 'stable'
      }
    }],
    files: {}
  }
}

describe('M5B legacy-to-v2 differential harness', () => {
  it('clones one explicit /tmp pre-state and normalizes only an audited nested array field', async () => {
    const harness = await createSyntheticHarness()
    const runRoots: string[] = []
    const generatedIds: string[] = []
    try {
      const result = await runCommandDifferential({
        testId: 'M5B-DIFF-SYNTHETIC-HARNESS',
        preStateRoot: harness.root,
        timestamp: SYNTHETIC_TIME,
        ids: ['50000000-0000-4000-8000-000000000001'],
        oraclePaths: [FROZEN_ORACLE_PATH],
        normalizers: [{
          path: 'events.0.payload.infrastructure_id',
          rationale: 'legacy and v2 use distinct infrastructure-only identifiers',
          normalize: () => 'normalized-infrastructure-id'
        }],
        runLegacy: (context) => {
          runRoots.push(context.dataRoot)
          generatedIds.push(context.nextId())
          return snapshot('legacy-generated-id')
        },
        runV2: (context) => {
          runRoots.push(context.dataRoot)
          generatedIds.push(context.nextId())
          return snapshot('v2-generated-id')
        }
      })

      expect(result.testId).toBe('M5B-DIFF-SYNTHETIC-HARNESS')
      expect(result.oracle.paths).toEqual([FROZEN_ORACLE_PATH])
      expect(result.normalizedCanonicalJson).toContain('"infrastructure_id":"normalized-infrastructure-id"')
      expect(new Set(runRoots).size).toBe(2)
      expect(runRoots.every((root) => root.startsWith('/tmp/svets-m5b-differential-'))).toBe(true)
      expect(runRoots.every((root) => !existsSync(root))).toBe(true)
      expect(generatedIds).toEqual([
        '50000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001'
      ])
    } finally {
      harness.close()
    }
  })

  it('rejects a non-temporary pre-state before cloning or invoking either implementation', async () => {
    let calls = 0
    await expect(runCommandDifferential({
      testId: 'M5B-DIFF-SYNTHETIC-PATH-GUARD',
      preStateRoot: process.cwd(),
      timestamp: SYNTHETIC_TIME,
      ids: [],
      oraclePaths: [FROZEN_ORACLE_PATH],
      runLegacy: () => {
        calls += 1
        return snapshot('same')
      },
      runV2: () => {
        calls += 1
        return snapshot('same')
      }
    })).rejects.toThrow(/temporary directory/)
    expect(calls).toBe(0)
  })

  it('rejects a normalizer that targets a whole business object', async () => {
    const harness = await createSyntheticHarness()
    try {
      await expect(runCommandDifferential({
        testId: 'M5B-DIFF-SYNTHETIC-NORMALIZER-GUARD',
        preStateRoot: harness.root,
        timestamp: SYNTHETIC_TIME,
        ids: [],
        oraclePaths: [FROZEN_ORACLE_PATH],
        normalizers: [{
          path: 'events.0.payload',
          rationale: 'deliberately invalid whole-payload normalizer',
          normalize: () => ({ erased: true })
        }],
        runLegacy: () => snapshot('same'),
        runV2: () => snapshot('same')
      })).rejects.toThrow(/one scalar field/)
    } finally {
      harness.close()
    }
  })
})
