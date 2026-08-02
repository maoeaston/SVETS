import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import {
  M5B_EXPECTED,
  M5B_SOURCE_DIGEST,
  loadM5bInventoryDocuments,
  scanBeforeM5bSourceDeltas,
  scanM5bCheckout,
  validateM5bBaseline,
  validateM5bInventoryDocuments,
  validateM5bMigration
} from '../lib/m5b-runtime-inventory.mjs'
import { verifyM5bStep8SourceDelta } from '../update-m5b-step8-fixture.mjs'
import { verifyM5bStep9SourceDelta } from '../update-m5b-step9-fixture.mjs'
import { verifyM5bStep10SourceDelta } from '../update-m5b-step10-fixture.mjs'
import { verifyM5bStep11SourceDelta } from '../update-m5b-step11-fixture.mjs'
import { verifyM5bStep12SourceDelta } from '../update-m5b-step12-fixture.mjs'
import { verifyM5bStep13SourceDelta } from '../update-m5b-step13-fixture.mjs'
import { verifyM5bStep14SourceDelta } from '../update-m5b-step14-fixture.mjs'
import { verifyM5bStep15SourceDelta } from '../update-m5b-step15-fixture.mjs'

const projectRoot = process.cwd()

function clone(value) {
  return structuredClone(value)
}

function clonedDocuments() {
  const documents = loadM5bInventoryDocuments(projectRoot)
  return Object.fromEntries(Object.entries(documents).map(([key, value]) => [key, clone(value)]))
}

function reviewedStep2Scan(documents) {
  const removed = new Set(documents.step2SourceDelta.removed_source.map((entry) => entry.fingerprint))
  return {
    channels: documents.active.channels,
    direct_callsites: [
      ...documents.active.direct_callsites.filter((entry) => !removed.has(entry.fingerprint)),
      ...documents.step2SourceDelta.added_target
    ],
    direct_files: Array.from({ length: documents.step2SourceDelta.expected_counts.direct_files }, (_, index) => `step2-file-${index}`),
    capability_callsites: documents.active.capability_callsites,
    delegating_roots: Array.from({ length: documents.step2SourceDelta.expected_counts.delegating_roots }, (_, index) => `step2-root-${index}`),
    test_only_import_violations: [],
    digest: documents.step2SourceDelta.target_digest
  }
}

function reviewedStep3Scan(documents) {
  const step2Removed = new Set(documents.step2SourceDelta.removed_source.map((entry) => entry.fingerprint))
  const step2Direct = [
    ...documents.active.direct_callsites.filter((entry) => !step2Removed.has(entry.fingerprint)),
    ...documents.step2SourceDelta.added_target
  ]
  const step3Removed = new Set(documents.step3SourceDelta.removed_source.map((entry) => entry.fingerprint))
  return {
    channels: documents.active.channels,
    direct_callsites: [
      ...step2Direct.filter((entry) => !step3Removed.has(entry.fingerprint)),
      ...documents.step3SourceDelta.added_target
    ],
    direct_files: Array.from({ length: documents.step3SourceDelta.expected_counts.direct_files }, (_, index) => `step3-file-${index}`),
    capability_callsites: documents.active.capability_callsites,
    delegating_roots: Array.from({ length: documents.step3SourceDelta.expected_counts.delegating_roots }, (_, index) => `step3-root-${index}`),
    test_only_import_violations: [],
    digest: documents.step3SourceDelta.target_digest
  }
}

function reviewedStep4Scan(documents) {
  const step3Scan = reviewedStep3Scan(documents)
  const removed = new Set(documents.step4SourceDelta.removed_source.map((entry) => entry.fingerprint))
  return {
    channels: documents.active.channels,
    direct_callsites: [
      ...step3Scan.direct_callsites.filter((entry) => !removed.has(entry.fingerprint)),
      ...documents.step4SourceDelta.added_target
    ],
    direct_files: Array.from({ length: documents.step4SourceDelta.expected_counts.direct_files }, (_, index) => `step4-file-${index}`),
    capability_callsites: documents.active.capability_callsites,
    delegating_roots: Array.from({ length: documents.step4SourceDelta.expected_counts.delegating_roots }, (_, index) => `step4-root-${index}`),
    test_only_import_violations: [],
    digest: documents.step4SourceDelta.target_digest
  }
}

function reviewedStep5Scan(documents) {
  const step4Scan = reviewedStep4Scan(documents)
  const removed = new Set(documents.step5SourceDelta.removed_source.map((entry) => entry.fingerprint))
  return {
    channels: documents.active.channels,
    direct_callsites: [
      ...step4Scan.direct_callsites.filter((entry) => !removed.has(entry.fingerprint)),
      ...documents.step5SourceDelta.added_target
    ],
    direct_files: Array.from({ length: documents.step5SourceDelta.expected_counts.direct_files }, (_, index) => `step5-file-${index}`),
    capability_callsites: [
      ...documents.active.capability_callsites.filter((entry) => !new Set(documents.step5SourceDelta.capability_removed_source.map((item) => item.fingerprint)).has(entry.fingerprint)),
      ...documents.step5SourceDelta.capability_added_target
    ],
    delegating_roots: Array.from({ length: documents.step5SourceDelta.expected_counts.delegating_roots }, (_, index) => `step5-root-${index}`),
    test_only_import_violations: [],
    digest: documents.step5SourceDelta.target_digest
  }
}

function reviewedStep6Scan(documents) {
  const step5Scan = reviewedStep5Scan(documents)
  return {
    channels: documents.active.channels,
    direct_callsites: [...step5Scan.direct_callsites, ...documents.step6SourceDelta.added_target],
    direct_files: Array.from({ length: documents.step6SourceDelta.expected_counts.direct_files }, (_, index) => `step6-file-${index}`),
    capability_callsites: step5Scan.capability_callsites,
    delegating_roots: Array.from({ length: documents.step6SourceDelta.expected_counts.delegating_roots }, (_, index) => `step6-root-${index}`),
    test_only_import_violations: [],
    digest: documents.step6SourceDelta.target_digest
  }
}

function reviewedStep7Scan(documents) {
  const step6Scan = reviewedStep6Scan(documents)
  const removed = new Set(documents.step7SourceDelta.removed_source.map((entry) => entry.fingerprint))
  return {
    channels: documents.active.channels,
    direct_callsites: [
      ...step6Scan.direct_callsites.filter((entry) => !removed.has(entry.fingerprint)),
      ...documents.step7SourceDelta.added_target
    ],
    direct_files: Array.from({ length: documents.step7SourceDelta.expected_counts.direct_files }, (_, index) => `step7-file-${index}`),
    capability_callsites: step6Scan.capability_callsites,
    delegating_roots: Array.from({ length: documents.step7SourceDelta.expected_counts.delegating_roots }, (_, index) => `step7-root-${index}`),
    test_only_import_violations: [],
    digest: documents.step7SourceDelta.target_digest
  }
}

function reviewedStep10Scan(documents) {
  const checkout = scanBeforeM5bSourceDeltas(scanM5bCheckout(projectRoot), [documents.step15SourceDelta, documents.step14SourceDelta])
  const m5b11Additions = new Set(documents.step11SourceDelta.added_target.map((entry) => entry.fingerprint))
  const m5b13Additions = new Set(documents.step13SourceDelta.added_target.map((entry) => entry.fingerprint))
  const m5b12Additions = new Set(documents.step12SourceDelta.added_target.map((entry) => entry.fingerprint))
  return {
    ...checkout,
    direct_callsites: [
      ...checkout.direct_callsites.filter((entry) => !m5b11Additions.has(entry.fingerprint) && !m5b13Additions.has(entry.fingerprint) && !m5b12Additions.has(entry.fingerprint)),
      ...documents.step11SourceDelta.removed_source
    ],
    direct_files: Array.from({ length: documents.step10SourceDelta.expected_counts.direct_files }, (_, index) => `step10-file-${index}`),
    digest: documents.step10SourceDelta.target_digest
  }
}

function reviewedStep11Scan(documents) {
  const checkout = scanBeforeM5bSourceDeltas(scanM5bCheckout(projectRoot), [documents.step15SourceDelta, documents.step14SourceDelta])
  const m5b13Additions = new Set(documents.step13SourceDelta.added_target.map((entry) => entry.fingerprint))
  const m5b12Additions = new Set(documents.step12SourceDelta.added_target.map((entry) => entry.fingerprint))
  return {
    ...checkout,
    direct_callsites: checkout.direct_callsites.filter((entry) => !m5b13Additions.has(entry.fingerprint) && !m5b12Additions.has(entry.fingerprint)),
    direct_files: Array.from({ length: documents.step11SourceDelta.expected_counts.direct_files }, (_, index) => `step11-file-${index}`),
    digest: documents.step11SourceDelta.target_digest
  }
}

describe('M5B event batch runtime inventory', () => {
  it('freezes the M5A source and the exact 75/29/46, 36/10 target', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    expect(validateM5bBaseline(documents)).toEqual({
      channels: 75,
      reads: 29,
      mutations: 46,
      batch: 36,
      gate: 10,
      active_entries: 361,
      mapping_entries: 378,
      exceptions: 76
    })
    expect(documents.inventory.source).toEqual({
      m5a_active_inventory_digest: M5B_SOURCE_DIGEST,
      m5a_channels: 74,
      m5a_reads: 28,
      m5a_mutations: 46,
      m5a_active_entries: 361,
      m5a_mapping_entries: 378,
      m5a_registered_exceptions: 76
    })
    expect(documents.inventory.target.new_read_channels).toEqual(['runtime:getHealth'])
  })

  it('uses the main-process composition root for target writer reachability', () => {
    const scan = scanM5bCheckout(projectRoot)
    expect(scan.production_reachable_files).toContain('src/main/index.ts')
    expect(scan.production_reachable_files).toContain('src/main/ipc/handler-registry.ts')
    expect(scan.production_capability_callsites.filter((entry) =>
      entry.kind === 'LEGACY_EVENT_PORT_CALL' || entry.kind === 'REPORT_COMMAND_CALL'
    )).toEqual([])
    expect(scan.production_prepare_oracle_callsites.length).toBeGreaterThan(0)
  })

  it('tracks school-demo additions separately from the frozen M5B-15 digest', () => {
    const addendum = scanM5bCheckout(projectRoot).post_m5b_school_demo
    expect(addendum.channels.map((entry) => entry.channel).sort()).toEqual([
      'activation:activate',
      'activation:configureServer',
      'activation:getStatus',
      'activation:validate',
      'questionBank:list'
    ])
    expect(addendum.direct_callsites).toHaveLength(9)
    expect(new Set(addendum.direct_callsites.map((entry) => entry.target_class))).toEqual(new Set([
      'ASSESSMENT_PREPARED_PROJECTOR_REPAIR',
      'CONTENT_PACK_DEMO_ACTIVATION',
      'CONTENT_PACK_DOMAIN_SEED',
      'SCORING_PLANNING_PROJECTION_SEED',
      'TEST_ONLY_PLANNING_CLONE_FK_PARITY'
    ]))
    expect(addendum.capability_callsites.map((entry) => entry.target_class).sort()).toEqual([
      'ACTIVATION_BOUNDARY_REGISTRATION',
      'QUESTION_BANK_CATALOG_BOUNDARY_REGISTRATION'
    ])
  })

  it('classifies all 46 command rows and binds unique differential evidence', () => {
    const { inventory } = loadM5bInventoryDocuments(projectRoot)
    const classes = inventory.commands.reduce((counts, entry) => {
      counts[entry.execution_class] = (counts[entry.execution_class] ?? 0) + 1
      return counts
    }, {})
    expect(classes).toEqual({ BATCH_DOMAIN_MUTATION: 36, GATE_ONLY_MUTATION: 10 })
    expect(new Set(inventory.commands.map((entry) => entry.differential_test_id)).size).toBe(46)
    expect(inventory.commands.filter((entry) => entry.allowed_behavior_differences.length > 0).map((entry) => entry.channel).sort())
      .toEqual(['assessment:triggerRedline', 'reports:export'])
  })

  it('reclassifies all 76 exceptions individually instead of inheriting an allowlist', () => {
    const { inventory } = loadM5bInventoryDocuments(projectRoot)
    expect(inventory.exceptions).toHaveLength(76)
    expect(new Set(inventory.exceptions.map((entry) => entry.mapping_id)).size).toBe(76)
    expect(inventory.exceptions.reduce((counts, entry) => {
      counts[entry.target_class] = (counts[entry.target_class] ?? 0) + 1
      return counts
    }, {})).toEqual({ TEST_ONLY: 29, PRE_GATE_MIGRATION_INTERNAL: 47 })
    expect(inventory.exceptions.every((entry) => entry.rationale.trim().length > 0)).toBe(true)
  })

  it('carries all 361 active and 378 mapping IDs exactly once', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    expect(validateM5bInventoryDocuments(documents)).toBe(documents.inventory)
    expect(new Set(documents.inventory.active_entries.map((entry) => entry.active_id)).size).toBe(M5B_EXPECTED.active_entries)
    expect(new Set(documents.inventory.mapping_entries.map((entry) => entry.mapping_id)).size).toBe(M5B_EXPECTED.mapping_entries)
  })

  it('passes M5B-1 migration only against the frozen checkout digest', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const scan = {
      channels: documents.active.channels,
      direct_callsites: documents.active.direct_callsites,
      direct_files: documents.active.direct_files,
      capability_callsites: documents.active.capability_callsites,
      delegating_roots: documents.active.delegating_roots,
      test_only_import_violations: [],
      digest: M5B_SOURCE_DIGEST
    }
    const result = validateM5bMigration({ scan, ...documents, step: 'M5B-1' })
    expect(result).toMatchObject({
      command_pending: 46,
      health_pending: 1,
      legacy_pending: 43,
      report_pending: 8,
      digest: M5B_SOURCE_DIGEST
    })
  })

  it('pins the exact reviewed M5B-2 source delta and its six individual dispositions', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const scan = reviewedStep2Scan(documents)
    const result = validateM5bMigration({ scan, ...documents, step: 'M5B-2' })
    expect(result.digest).toBe(documents.step2SourceDelta.target_digest)
    expect(documents.step2SourceDelta.removed_source).toHaveLength(3)
    expect(documents.step2SourceDelta.added_target).toHaveLength(6)
    expect(documents.step2SourceDelta.added_target.reduce((counts, entry) => {
      counts[entry.target_class] = (counts[entry.target_class] ?? 0) + 1
      return counts
    }, {})).toEqual({
      PRE_GATE_MIGRATION_INTERNAL: 3,
      TEST_ONLY_ADAPTER_INFRASTRUCTURE: 3
    })
  })

  it('pins the exact reviewed M5B-3 storage source delta and its eighteen dispositions', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const scan = reviewedStep3Scan(documents)
    const result = validateM5bMigration({ scan, ...documents, step: 'M5B-3' })
    expect(result.digest).toBe(documents.step3SourceDelta.target_digest)
    expect(documents.step3SourceDelta.removed_source).toEqual([])
    expect(documents.step3SourceDelta.added_target).toHaveLength(18)
    expect(documents.step3SourceDelta.added_target.reduce((counts, entry) => {
      counts[entry.target_class] = (counts[entry.target_class] ?? 0) + 1
      return counts
    }, {})).toEqual({
      EVENT_BATCH_FILE_CAPABILITY_INTERNAL: 17,
      LEGACY_REPAIR_INTERNAL: 1
    })
  })

  it('pins the exact reviewed M5B-4 command-store source delta and its three dispositions', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const scan = reviewedStep4Scan(documents)
    const result = validateM5bMigration({ scan, ...documents, step: 'M5B-4' })
    expect(result.digest).toBe(documents.step4SourceDelta.target_digest)
    expect(documents.step4SourceDelta.removed_source).toEqual([])
    expect(documents.step4SourceDelta.added_target).toHaveLength(3)
    expect(documents.step4SourceDelta.added_target.reduce((counts, entry) => {
      counts[entry.target_class] = (counts[entry.target_class] ?? 0) + 1
      return counts
    }, {})).toEqual({
      EVENT_BATCH_COMMAND_STORE_INTERNAL: 3
    })
    expect(new Set(documents.step4SourceDelta.added_target.map((entry) => entry.file)))
      .toEqual(new Set(['src/main/application/command/durable-command-store.ts']))
  })

  it('pins the exact reviewed M5B-5 coordinator source delta and its internal dispositions', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const scan = reviewedStep5Scan(documents)
    const result = validateM5bMigration({ scan, ...documents, step: 'M5B-5' })
    expect(result.digest).toBe(documents.step5SourceDelta.target_digest)
    expect(documents.step5SourceDelta.removed_source).toEqual([])
    expect(documents.step5SourceDelta.added_target).toHaveLength(10)
    expect(documents.step5SourceDelta.added_target.reduce((counts, entry) => {
      counts[entry.target_class] = (counts[entry.target_class] ?? 0) + 1
      return counts
    }, {})).toEqual({
      EVENT_BATCH_COORDINATOR_INTERNAL: 1,
      EVENT_BATCH_REBUILD_INTERNAL: 1,
      EVENT_BATCH_PROJECTION_INTERNAL: 5,
      EVENT_BATCH_RECOVERY_INTERNAL: 3
    })
    expect(documents.step5SourceDelta.capability_removed_source).toEqual([])
    expect(documents.step5SourceDelta.capability_added_target).toMatchObject([
      {
        file: 'src/main/domain/event-batch/mixed-domain-replay.ts',
        kind: 'LEGACY_RECOVERY_CALL',
        callee: 'reconcileActionLogEventGroup',
        target_class: 'EVENT_BATCH_REBUILD_LEGACY_COMPATIBILITY',
        planned_step: 'M5B-5'
      }
    ])
  })

  it('pins the exact reviewed M5B-7 gate-only source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: reviewedStep7Scan(documents), ...documents, step: 'M5B-7' })
    expect(result.digest).toBe(documents.step7SourceDelta.target_digest)
    expect(documents.step7SourceDelta.removed_source).toHaveLength(6)
    expect(documents.step7SourceDelta.added_target).toHaveLength(6)
    expect(documents.step7SourceDelta.capability_removed_source).toEqual([])
    expect(documents.step7SourceDelta.capability_added_target).toEqual([])
    expect(documents.step7SourceDelta.added_target.map((entry) => entry.target_class))
      .toEqual(Array(6).fill('GATE_ONLY_EXTERNAL_TRANSACTION_DML'))
  })

  it('pins the exact reviewed M5B-8 training prepared-projector source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: reviewedStep10Scan(documents), ...documents, step: 'M5B-8' })
    expect(result.digest).toBe(documents.step8SourceDelta.target_digest)
    expect(documents.step8SourceDelta.removed_source).toEqual([])
    expect(documents.step8SourceDelta.added_target).toHaveLength(9)
    expect(documents.step8SourceDelta.capability_removed_source).toEqual([])
    expect(documents.step8SourceDelta.capability_added_target).toEqual([])
    expect(documents.step8SourceDelta.added_target.map((entry) => entry.target_class))
      .toEqual(Array(9).fill('TRAINING_PREPARED_PROJECTOR_INTERNAL'))
  })

  it('pins the exact reviewed M5B-9 assessment prepared-projector source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: reviewedStep10Scan(documents), ...documents, step: 'M5B-9' })
    expect(result.digest).toBe(documents.step9SourceDelta.target_digest)
    expect(documents.step9SourceDelta.removed_source).toEqual([])
    expect(documents.step9SourceDelta.added_target).toEqual([])
    expect(documents.step9SourceDelta.capability_removed_source).toEqual([])
    expect(documents.step9SourceDelta.capability_added_target).toEqual([])
  })

  it('pins the exact reviewed M5B-10 test-only scoring prepared-fact source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: reviewedStep10Scan(documents), ...documents, step: 'M5B-10' })
    expect(result.digest).toBe(documents.step10SourceDelta.target_digest)
    expect(documents.step10SourceDelta.removed_source).toEqual([])
    expect(documents.step10SourceDelta.added_target).toEqual([])
    expect(documents.step10SourceDelta.capability_removed_source).toEqual([])
    expect(documents.step10SourceDelta.capability_added_target).toEqual([])
  })

  it('pins the exact reviewed M5B-11 assignment runtime prepared-effect source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: reviewedStep11Scan(documents), ...documents, step: 'M5B-11' })
    expect(result.digest).toBe(documents.step11SourceDelta.target_digest)
    expect(documents.step11SourceDelta.removed_source).toHaveLength(5)
    expect(documents.step11SourceDelta.added_target).toHaveLength(5)
    expect(new Set(documents.step11SourceDelta.removed_source.map((entry) => entry.disposition)))
      .toEqual(new Set(['REFACTORED_TO_PREPARED_RUNTIME_EFFECT']))
    expect(new Set(documents.step11SourceDelta.added_target.map((entry) => entry.target_class)))
      .toEqual(new Set(['ASSIGNMENT_RUNTIME_PREPARED_EFFECT']))
  })

  it('pins the exact reviewed M5B-13 artifact prepared-effect source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: scanM5bCheckout(projectRoot), ...documents, step: 'M5B-13' })
    expect(result.digest).toBe(documents.step13SourceDelta.target_digest)
    expect(documents.step13SourceDelta.removed_source).toEqual([])
    expect(documents.step13SourceDelta.added_target).toHaveLength(14)
    expect(new Set(documents.step13SourceDelta.added_target.map((entry) => entry.target_class))).toEqual(new Set([
      'REPORT_EXPORT_ARTIFACT_PREPARE_EFFECT',
      'REPORT_EXPORT_PREPARED_PROJECTOR'
    ]))
  })

  it('pins the exact reviewed M5B-12 safety prepared-projector source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: scanM5bCheckout(projectRoot), ...documents, step: 'M5B-12' })
    expect(result.digest).toBe(documents.step12SourceDelta.target_digest)
    expect(documents.step12SourceDelta.removed_source).toEqual([])
    expect(documents.step12SourceDelta.added_target).toHaveLength(8)
    expect(new Set(documents.step12SourceDelta.added_target.map((entry) => entry.target_class)))
      .toEqual(new Set(['SAFETY_PREPARED_PROJECTOR']))
  })

  it('pins the exact reviewed M5B-14 production cutover source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: scanM5bCheckout(projectRoot), ...documents, step: 'M5B-14' })
    expect(result.digest).toBe(documents.step14SourceDelta.target_digest)
    expect(documents.step14SourceDelta.removed_source).toHaveLength(3)
    expect(documents.step14SourceDelta.added_target).toHaveLength(5)
    expect(documents.step14SourceDelta.capability_removed_source).toHaveLength(4)
    expect(documents.step14SourceDelta.capability_added_target).toHaveLength(2)
    expect(documents.step14SourceDelta.channel_added_target.map((entry) => entry.channel))
      .toEqual(['runtime:getHealth'])
    expect(documents.step14SourceDelta.delegating_root_added_target).toHaveLength(2)
  })

  it('pins the exact reviewed M5B-15 runtime repair source delta', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const result = validateM5bMigration({ scan: scanM5bCheckout(projectRoot), ...documents, step: 'M5B-15' })
    expect(result.digest).toBe(documents.step15SourceDelta.target_digest)
    expect(documents.step15SourceDelta.removed_source).toEqual([])
    expect(documents.step15SourceDelta.added_target).toHaveLength(4)
    expect(new Set(documents.step15SourceDelta.added_target.map((entry) => entry.target_class))).toEqual(new Set([
      'ASSIGNMENT_PLANNING_PROJECTION_SEED',
      'PREPARE_ONLY_PLANNING_CLONE'
    ]))
    expect(documents.step15SourceDelta.capability_added_target).toEqual([])
    expect(verifyM5bStep15SourceDelta().status).toBe('verified')
  })

  it('rejects duplicate/missing command, active and mapping rows', () => {
    for (const mutate of [
      (documents) => documents.inventory.commands.push(clone(documents.inventory.commands[0])),
      (documents) => documents.inventory.commands.pop(),
      (documents) => documents.inventory.active_entries.pop(),
      (documents) => documents.inventory.mapping_entries.pop()
    ]) {
      const documents = clonedDocuments()
      mutate(documents)
      expect(() => validateM5bInventoryDocuments(documents)).toThrow(/m5b-event-batch/)
    }
  })

  it('rejects family/class drift and undeclared semantic differences', () => {
    const classDrift = clonedDocuments()
    classDrift.inventory.commands.find((entry) => entry.execution_class === 'GATE_ONLY_MUTATION').execution_class = 'BATCH_DOMAIN_MUTATION'
    expect(() => validateM5bInventoryDocuments(classDrift)).toThrow(/command count/)

    const familyDrift = clonedDocuments()
    familyDrift.inventory.commands[0].family = 'training'
    expect(() => validateM5bInventoryDocuments(familyDrift)).toThrow(/command count/)

    const differenceDrift = clonedDocuments()
    differenceDrift.inventory.commands.find((entry) => entry.channel === 'training:createSession').allowed_behavior_differences.push({ id: 'WILDCARD' })
    expect(() => validateM5bInventoryDocuments(differenceDrift)).toThrow(/allowed differential channels/)
  })

  it('rejects missing or bulk-relabelled exception dispositions', () => {
    const missing = clonedDocuments()
    missing.inventory.exceptions.pop()
    expect(() => validateM5bInventoryDocuments(missing)).toThrow(/exception disposition count/)

    const relabelled = clonedDocuments()
    for (const entry of relabelled.inventory.exceptions) entry.target_class = 'TEST_ONLY'
    expect(() => validateM5bInventoryDocuments(relabelled)).toThrow(/target class/)
  })

  it('rejects non-monotonic pending fixtures and source digest drift', () => {
    const pending = clonedDocuments()
    pending.inventory.expected_pending['M5B-2'].command_channels.push('invented:command')
    expect(() => validateM5bInventoryDocuments(pending)).toThrow(/not monotonic/)

    const documents = loadM5bInventoryDocuments(projectRoot)
    const scan = { ...scanM5bCheckout(projectRoot), digest: '0'.repeat(64) }
    expect(() => validateM5bMigration({ scan, ...documents, step: 'M5B-1' })).toThrow(/checkout digest drifted/)

    const step2 = clonedDocuments()
    step2.step2SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step2)).toThrow(/migration-internal additions|adapter additions/)

    const step3 = clonedDocuments()
    step3.step3SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step3)).toThrow(/file-capability additions|legacy-repair additions/)

    const step4 = clonedDocuments()
    step4.step4SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step4)).toThrow(/command-store additions/)

    const step5 = clonedDocuments()
    step5.step5SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step5)).toThrow(/coordinator additions|rebuild additions|projection additions|recovery additions/)

    const step6 = clonedDocuments()
    step6.step6SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step6)).toThrow(/report\/closure projector additions/)

    const step8 = clonedDocuments()
    step8.step8SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step8)).toThrow(/training projector additions/)

    const step13 = clonedDocuments()
    step13.step13SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step13)).toThrow(/M5B-13 added target classes/)

    const step12 = clonedDocuments()
    step12.step12SourceDelta.added_target[0].target_class = 'UNCLASSIFIED'
    expect(() => validateM5bInventoryDocuments(step12)).toThrow(/M5B-12 added target classes/)
  })

  it('closes target mode only after health and legacy retirement are complete', () => {
    const documents = loadM5bInventoryDocuments(projectRoot)
    const scan = scanM5bCheckout(projectRoot)
    expect(validateM5bMigration({ scan, ...documents, step: 'M5B-15', target: true })).toMatchObject({
      command_pending: 0,
      health_pending: 0,
      legacy_pending: 0,
      report_pending: 0
    })

    const pending = clonedDocuments()
    pending.inventory.expected_pending['M5B-15'].runtime_health_channel = true
    expect(() => validateM5bMigration({ scan, ...pending, step: 'M5B-15', target: true }))
      .toThrow(/reintroduced runtime health pending state/)
  })

  it('refuses to regenerate the frozen implementation-start fixtures', () => {
    const paths = [
      'scripts/fixtures/m5b-implementation-start-v1.json',
      'scripts/fixtures/m5b-command-runtime-inventory-v1.json'
    ]
    const before = paths.map((path) => createHash('sha256').update(readFileSync(path)).digest('hex'))
    const result = spawnSync(process.execPath, ['scripts/update-m5b-step1-fixtures.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('fixtures are frozen')
    expect(paths.map((path) => createHash('sha256').update(readFileSync(path)).digest('hex'))).toEqual(before)
  })

  it('refuses to overwrite the frozen M5B-2 source delta fixture', () => {
    const path = 'scripts/fixtures/m5b-step2-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    const result = spawnSync(process.execPath, ['scripts/update-m5b-step2-fixture.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-3 vectors and source delta immutable after later steps', () => {
    const paths = [
      'scripts/fixtures/m5b-event-batch-golden-v1.json',
      'scripts/fixtures/m5b-step3-source-delta-v1.json'
    ]
    const before = paths.map((path) => createHash('sha256').update(readFileSync(path)).digest('hex'))
    const result = spawnSync(process.execPath, ['scripts/update-m5b-step3-fixture.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checkout does not match the reviewed M5B-3 source delta')
    expect(paths.map((path) => createHash('sha256').update(readFileSync(path)).digest('hex'))).toEqual(before)
  })

  it('keeps the frozen M5B-4 source delta immutable after M5B-5', () => {
    const path = 'scripts/fixtures/m5b-step4-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    const result = spawnSync(process.execPath, ['scripts/update-m5b-step4-fixture.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checkout does not match the reviewed M5B-4 source delta')
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-5 source delta immutable after M5B-6', () => {
    const path = 'scripts/fixtures/m5b-step5-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    const result = spawnSync(process.execPath, ['scripts/update-m5b-step5-fixture.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checkout does not match the reviewed M5B-5 source delta')
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-6 source delta immutable after M5B-7', () => {
    const path = 'scripts/fixtures/m5b-step6-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    const result = spawnSync(process.execPath, ['scripts/update-m5b-step6-fixture.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checkout does not match the reviewed M5B-6 source delta')
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-7 source delta immutable after M5B-8', () => {
    const path = 'scripts/fixtures/m5b-step7-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    const result = spawnSync(process.execPath, ['scripts/update-m5b-step7-fixture.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checkout does not match the reviewed M5B-7 source delta')
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-8 source delta immutable after M5B-11', () => {
    const path = 'scripts/fixtures/m5b-step8-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(() => verifyM5bStep8SourceDelta()).toThrow(/checkout does not match the reviewed M5B-8 source delta/)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-9 source delta immutable after M5B-11', () => {
    const path = 'scripts/fixtures/m5b-step9-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(() => verifyM5bStep9SourceDelta()).toThrow(/checkout does not match the reviewed M5B-9 source delta/)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-10 source delta immutable after M5B-11', () => {
    const path = 'scripts/fixtures/m5b-step10-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(() => verifyM5bStep10SourceDelta()).toThrow(/checkout does not match the reviewed M5B-10 source delta/)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('keeps the frozen M5B-11 source delta immutable after M5B-13', () => {
    const path = 'scripts/fixtures/m5b-step11-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(() => verifyM5bStep11SourceDelta()).toThrow(/checkout does not match the reviewed M5B-11 source delta/)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('verifies the frozen M5B-13 source delta without rewriting it', () => {
    const path = 'scripts/fixtures/m5b-step13-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(verifyM5bStep13SourceDelta().status).toBe('verified')
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('verifies the frozen M5B-12 source delta without rewriting it', () => {
    const path = 'scripts/fixtures/m5b-step12-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(verifyM5bStep12SourceDelta().status).toBe('verified')
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })

  it('verifies the frozen M5B-14 source delta without rewriting it', () => {
    const path = 'scripts/fixtures/m5b-step14-source-delta-v1.json'
    const before = createHash('sha256').update(readFileSync(path)).digest('hex')
    expect(verifyM5bStep14SourceDelta().status).toBe('verified')
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before)
  })
})
