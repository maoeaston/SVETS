import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

import {
  inventoryDigest as m5aInventoryDigest,
  loadInventoryDocuments as loadM5aInventoryDocuments,
  scanCheckout as scanM5aCheckout
} from './m5a-command-boundary-inventory.mjs'

export const M5B_INVENTORY_SCHEMA_VERSION = 'm5b-command-runtime-inventory-v1'
export const M5B_START_SCHEMA_VERSION = 'm5b-implementation-start-v1'
export const M5B_STEP_DELTA_SCHEMA_VERSION = 'm5b-step-source-delta-v1'
export const M5B_SOURCE_DIGEST = 'f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527'
export const M5B_EXPECTED = Object.freeze({
  source_channels: 74,
  source_reads: 28,
  mutations: 46,
  target_channels: 75,
  target_reads: 29,
  batch_domain_mutations: 36,
  gate_only_mutations: 10,
  active_entries: 361,
  mapping_entries: 378,
  exceptions: 76,
  test_only: 29,
  pre_gate_migration_internal: 47,
  legacy_event_ports: 43,
  request_report_commands: 8
})

const EXECUTION_CLASSES = new Set([
  'READ',
  'BATCH_DOMAIN_MUTATION',
  'GATE_ONLY_MUTATION',
  'PRE_GATE_MIGRATION_INTERNAL',
  'RECOVERY_INTERNAL',
  'TEST_ONLY'
])

const FAMILY_COUNTS = Object.freeze({
  assessment: 15,
  assignment: 5,
  auth: 4,
  reports: 6,
  safety: 4,
  strategy: 3,
  student: 3,
  training: 6
})

// These files are invoked only through an in-memory planning clone whose
// injected port records EventIntent candidates. They are not production
// writers: the central IPC boundary no longer constructs or supplies a legacy
// mutation port. Keeping this list exact makes new legacy runtime edges fail.
const PREPARE_ONLY_LEGACY_ORACLE_FILES = new Set([
  'src/main/application/services/ability-scoring-service.ts',
  'src/main/application/services/assessment-service.ts',
  'src/main/application/services/assignment-service.ts',
  'src/main/application/services/job-skill-result-service.ts',
  'src/main/application/services/job-skill-scoring-service.ts',
  'src/main/application/services/observation-service.ts',
  'src/main/application/services/operation-scoring-service.ts',
  'src/main/application/services/training-service.ts',
  'src/main/domain/report-export.ts',
  'src/main/domain/report-service.ts'
])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function normalizeRepoPath(path) {
  return path.replaceAll('\\', '/')
}

function isRuntimeImportClause(clause) {
  if (!clause || clause.isTypeOnly) return false
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return true
  return Boolean(clause.name) || clause.namedBindings.elements.some((element) => !element.isTypeOnly)
}

function resolveLocalTypeScriptSource(projectRoot, importer, specifier) {
  if (!specifier.startsWith('.')) return null
  const root = resolve(projectRoot)
  const candidate = resolve(dirname(importer), specifier)
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    throw new M5bInventoryError(`production import escapes project root: ${specifier}`)
  }
  for (const path of [
    `${candidate}.ts`,
    `${candidate}.tsx`,
    join(candidate, 'index.ts'),
    join(candidate, 'index.tsx')
  ]) {
    if (existsSync(path)) return path
  }
  return null
}

/**
 * The M5A ledger scans every source file, including retained test-only legacy
 * adapters. The M5B target gate instead follows runtime imports from main's
 * composition root so that retained test seams cannot mask a production edge.
 */
export function scanM5bProductionReachability(projectRoot) {
  const root = resolve(projectRoot)
  const entrypoint = resolve(root, 'src/main/index.ts')
  const pending = [entrypoint]
  const visited = new Set()

  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const addSpecifier = (specifier) => {
      const dependency = resolveLocalTypeScriptSource(root, file, specifier)
      if (dependency && !visited.has(dependency)) pending.push(dependency)
    }
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && isRuntimeImportClause(statement.importClause)) {
        addSpecifier(statement.moduleSpecifier.text)
      }
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier) {
        addSpecifier(statement.moduleSpecifier.text)
      }
    }
  }

  return new Set([...visited].map((file) => normalizeRepoPath(relative(root, file))))
}

function sorted(values) {
  return [...values].sort()
}

function unique(values, label) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) throw new M5bInventoryError(`${label} contains duplicate ${value}`)
    seen.add(value)
  }
  return seen
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new M5bInventoryError(`${label}: expected ${expected}, got ${actual}`)
}

function assertExactSet(actualValues, expectedValues, label) {
  const actual = sorted(unique(actualValues, `${label} actual`))
  const expected = sorted(unique(expectedValues, `${label} expected`))
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    const actualSet = new Set(actual)
    const expectedSet = new Set(expected)
    const missing = expected.filter((value) => !actualSet.has(value))
    const unexpected = actual.filter((value) => !expectedSet.has(value))
    throw new M5bInventoryError(`${label} mismatch; missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'}`)
  }
}

function countBy(items, selector) {
  const result = {}
  for (const item of items) {
    const key = selector(item)
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

function validateStepOrder(inventory) {
  assertEqual(inventory.step_order.length, 15, 'step_order length')
  assertExactSet(inventory.step_order, Array.from({ length: 15 }, (_, index) => `M5B-${index + 1}`), 'step_order')
  for (let index = 0; index < inventory.step_order.length; index += 1) {
    assertEqual(inventory.step_order[index], `M5B-${index + 1}`, `step_order[${index}]`)
  }
  assertExactSet(Object.keys(inventory.expected_pending), inventory.step_order, 'expected_pending steps')

  let previous = null
  for (const step of inventory.step_order) {
    const current = inventory.expected_pending[step]
    if (!current || !Array.isArray(current.command_channels) || !Array.isArray(current.legacy_event_port_ids) || !Array.isArray(current.request_report_command_ids)) {
      throw new M5bInventoryError(`expected_pending.${step} is incomplete`)
    }
    unique(current.command_channels, `${step} command pending`)
    unique(current.legacy_event_port_ids, `${step} legacy event pending`)
    unique(current.request_report_command_ids, `${step} report pending`)
    if (typeof current.runtime_health_channel !== 'boolean') throw new M5bInventoryError(`${step} runtime_health_channel must be boolean`)
    if (previous) {
      for (const key of ['command_channels', 'legacy_event_port_ids', 'request_report_command_ids']) {
        const previousSet = new Set(previous[key])
        const additions = current[key].filter((value) => !previousSet.has(value))
        if (additions.length > 0) throw new M5bInventoryError(`${step} ${key} is not monotonic; additions=${additions.join(',')}`)
      }
      if (previous.runtime_health_channel === false && current.runtime_health_channel === true) {
        throw new M5bInventoryError(`${step} reintroduced runtime health pending state`)
      }
    }
    previous = current
  }
}

function validateCommands(inventory, m5aActive) {
  const mutationChannels = m5aActive.channels.filter((entry) => entry.mode === 'MUTATION').map((entry) => entry.channel)
  assertEqual(inventory.commands.length, M5B_EXPECTED.mutations, 'command row count')
  assertExactSet(inventory.commands.map((entry) => entry.channel), mutationChannels, 'command channels')

  const classCounts = countBy(inventory.commands, (entry) => entry.execution_class)
  assertEqual(classCounts.BATCH_DOMAIN_MUTATION ?? 0, M5B_EXPECTED.batch_domain_mutations, 'batch-domain command count')
  assertEqual(classCounts.GATE_ONLY_MUTATION ?? 0, M5B_EXPECTED.gate_only_mutations, 'gate-only command count')
  assertExactSet(Object.keys(classCounts), ['BATCH_DOMAIN_MUTATION', 'GATE_ONLY_MUTATION'], 'command execution classes')

  const familyCounts = countBy(inventory.commands, (entry) => entry.family)
  assertExactSet(Object.keys(familyCounts), Object.keys(FAMILY_COUNTS), 'command families')
  for (const [family, expected] of Object.entries(FAMILY_COUNTS)) {
    assertEqual(familyCounts[family], expected, `${family} command count`)
  }

  unique(inventory.commands.map((entry) => entry.differential_test_id), 'differential test ids')
  const allowedDifferenceChannels = inventory.commands
    .filter((entry) => entry.allowed_behavior_differences.length > 0)
    .map((entry) => entry.channel)
  assertExactSet(allowedDifferenceChannels, ['assessment:triggerRedline', 'reports:export'], 'allowed differential channels')
  for (const command of inventory.commands) {
    if (!inventory.step_order.includes(command.planned_step)) throw new M5bInventoryError(`${command.channel} has unknown planned step ${command.planned_step}`)
    if (!/^M5B-DIFF-[A-Z0-9-]+$/.test(command.differential_test_id)) {
      throw new M5bInventoryError(`${command.channel} has invalid differential test id`)
    }
    if (!Array.isArray(command.allowed_behavior_differences)) throw new M5bInventoryError(`${command.channel} allowed differences must be an array`)
  }
}

function validateActiveEntries(inventory, m5aActive) {
  const sourceEntries = [
    ...m5aActive.channels.map((entry) => ({ ...entry, source_kind: 'CHANNEL' })),
    ...m5aActive.direct_callsites.map((entry) => ({ ...entry, source_kind: 'DIRECT_CALLSITE' })),
    ...m5aActive.capability_callsites.map((entry) => ({ ...entry, source_kind: 'CAPABILITY_CALLSITE' }))
  ]
  assertEqual(sourceEntries.length, M5B_EXPECTED.active_entries, 'M5A active source count')
  assertEqual(inventory.active_entries.length, M5B_EXPECTED.active_entries, 'M5B active disposition count')
  assertExactSet(inventory.active_entries.map((entry) => entry.active_id), sourceEntries.map((entry) => entry.id), 'active disposition IDs')
  const sourceById = new Map(sourceEntries.map((entry) => [entry.id, entry]))
  for (const entry of inventory.active_entries) {
    const source = sourceById.get(entry.active_id)
    if (!source) throw new M5bInventoryError(`unknown active disposition ${entry.active_id}`)
    assertEqual(entry.source_kind, source.source_kind, `${entry.active_id} source kind`)
    assertEqual(entry.source_file, source.file, `${entry.active_id} source file`)
    if (!EXECUTION_CLASSES.has(entry.target_class)) throw new M5bInventoryError(`${entry.active_id} has invalid target class ${entry.target_class}`)
    if (entry.classification_status !== 'CLASSIFIED') throw new M5bInventoryError(`${entry.active_id} is not classified`)
    if (!inventory.step_order.includes(entry.planned_step)) throw new M5bInventoryError(`${entry.active_id} has invalid planned step`)
  }
}

function validateMappingAndExceptions(inventory, m5aMapping) {
  assertEqual(inventory.mapping_entries.length, M5B_EXPECTED.mapping_entries, 'M5B mapping disposition count')
  assertExactSet(inventory.mapping_entries.map((entry) => entry.mapping_id), m5aMapping.entries.map((entry) => entry.id), 'mapping disposition IDs')
  const activeIds = new Set(inventory.active_entries.map((entry) => entry.active_id))
  for (const entry of inventory.mapping_entries) {
    if (!activeIds.has(entry.active_id)) throw new M5bInventoryError(`${entry.mapping_id} references missing active ${entry.active_id}`)
    if (!EXECUTION_CLASSES.has(entry.target_class)) throw new M5bInventoryError(`${entry.mapping_id} target class is invalid`)
    if (entry.classification_status !== 'CLASSIFIED') throw new M5bInventoryError(`${entry.mapping_id} is not classified`)
  }

  const sourceExceptions = m5aMapping.entries.filter((entry) => entry.status === 'REGISTERED_EXCEPTION')
  assertEqual(inventory.exceptions.length, M5B_EXPECTED.exceptions, 'exception disposition count')
  assertExactSet(inventory.exceptions.map((entry) => entry.mapping_id), sourceExceptions.map((entry) => entry.id), 'exception disposition IDs')
  const sourceById = new Map(sourceExceptions.map((entry) => [entry.id, entry]))
  for (const entry of inventory.exceptions) {
    const source = sourceById.get(entry.mapping_id)
    if (!source) throw new M5bInventoryError(`unknown exception ${entry.mapping_id}`)
    assertEqual(entry.active_id, source.active_id, `${entry.mapping_id} active id`)
    assertEqual(entry.source_exception_kind, source.exception_kind, `${entry.mapping_id} source exception kind`)
    const expectedClass = source.exception_kind === 'TEST_ONLY' ? 'TEST_ONLY' : 'PRE_GATE_MIGRATION_INTERNAL'
    assertEqual(entry.target_class, expectedClass, `${entry.mapping_id} target class`)
    if (!entry.rationale?.trim()) throw new M5bInventoryError(`${entry.mapping_id} has no rationale`)
  }
  const targetCounts = countBy(inventory.exceptions, (entry) => entry.target_class)
  assertEqual(targetCounts.TEST_ONLY ?? 0, M5B_EXPECTED.test_only, 'TEST_ONLY exception count')
  assertEqual(targetCounts.PRE_GATE_MIGRATION_INTERNAL ?? 0, M5B_EXPECTED.pre_gate_migration_internal, 'PRE_GATE migration exception count')
}

function validateSourceAndTarget(inventory, m5aActive, m5aMapping) {
  const source = inventory.source
  assertEqual(source.m5a_active_inventory_digest, M5B_SOURCE_DIGEST, 'source digest')
  assertEqual(source.m5a_channels, M5B_EXPECTED.source_channels, 'source channel count')
  assertEqual(source.m5a_reads, M5B_EXPECTED.source_reads, 'source read count')
  assertEqual(source.m5a_mutations, M5B_EXPECTED.mutations, 'source mutation count')
  assertEqual(source.m5a_active_entries, M5B_EXPECTED.active_entries, 'source active entry count')
  assertEqual(source.m5a_mapping_entries, M5B_EXPECTED.mapping_entries, 'source mapping count')
  assertEqual(source.m5a_registered_exceptions, M5B_EXPECTED.exceptions, 'source exception count')
  assertEqual(m5aActive.source_digest, M5B_SOURCE_DIGEST, 'M5A active fixture digest')
  assertEqual(m5aMapping.entries.length, M5B_EXPECTED.mapping_entries, 'M5A mapping fixture count')

  const target = inventory.target
  assertEqual(target.invoke_channels, M5B_EXPECTED.target_channels, 'target channel count')
  assertEqual(target.reads, M5B_EXPECTED.target_reads, 'target read count')
  assertEqual(target.mutations, M5B_EXPECTED.mutations, 'target mutation count')
  assertEqual(target.batch_domain_mutations, M5B_EXPECTED.batch_domain_mutations, 'target batch count')
  assertEqual(target.gate_only_mutations, M5B_EXPECTED.gate_only_mutations, 'target gate count')
  assertEqual(target.legacy_event_port_target, 0, 'legacy event target')
  assertEqual(target.request_report_command_target, 0, 'request report target')
  assertExactSet(target.new_read_channels, ['runtime:getHealth'], 'new read channels')
  assertExactSet(target.existing_read_channels, m5aActive.channels.filter((entry) => entry.mode === 'READ').map((entry) => entry.channel), 'existing read channels')
}

export class M5bInventoryError extends Error {
  constructor(message) {
    super(`[m5b-event-batch] ${message}`)
    this.name = 'M5bInventoryError'
  }
}

export function loadM5bInventoryDocuments(projectRoot) {
  const m5a = loadM5aInventoryDocuments(projectRoot)
  const inventory = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-command-runtime-inventory-v1.json'))
  const implementationStart = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-implementation-start-v1.json'))
  const step2SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step2-source-delta-v1.json'))
  const step3SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step3-source-delta-v1.json'))
  const step4SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step4-source-delta-v1.json'))
  const step5SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step5-source-delta-v1.json'))
  const step6SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step6-source-delta-v1.json'))
  const step7SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step7-source-delta-v1.json'))
  const step8SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step8-source-delta-v1.json'))
  const step9SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step9-source-delta-v1.json'))
  const step10SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step10-source-delta-v1.json'))
  const step11SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step11-source-delta-v1.json'))
  const step13SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step13-source-delta-v1.json'))
  const step12SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step12-source-delta-v1.json'))
  const step14SourceDelta = readJson(resolve(projectRoot, 'scripts/fixtures/m5b-step14-source-delta-v1.json'))
  return {
    ...m5a,
    inventory,
    implementationStart,
    step2SourceDelta,
    step3SourceDelta,
    step4SourceDelta,
    step5SourceDelta,
    step6SourceDelta,
    step7SourceDelta,
    step8SourceDelta,
    step9SourceDelta,
    step10SourceDelta,
    step11SourceDelta,
    step13SourceDelta,
    step12SourceDelta,
    step14SourceDelta
  }
}

function validateStep2SourceDeltaFixture(step2SourceDelta, active) {
  if (step2SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-2 delta schema ${step2SourceDelta.schema_version}`)
  }
  assertEqual(step2SourceDelta.step, 'M5B-2', 'M5B-2 delta step')
  assertEqual(step2SourceDelta.source_digest, M5B_SOURCE_DIGEST, 'M5B-2 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step2SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-2 target digest')
  assertEqual(step2SourceDelta.removed_source.length, 3, 'M5B-2 removed source count')
  assertEqual(step2SourceDelta.added_target.length, 6, 'M5B-2 added target count')
  assertExactSet(
    step2SourceDelta.removed_source.map((entry) => entry.active_id),
    ['ACTIVE-DIRECT-012', 'ACTIVE-DIRECT-013', 'ACTIVE-DIRECT-014'],
    'M5B-2 refactored source IDs'
  )
  const activeById = new Map(active.direct_callsites.map((entry) => [entry.id, entry]))
  for (const entry of step2SourceDelta.removed_source) {
    const source = activeById.get(entry.active_id)
    if (!source || source.fingerprint !== entry.fingerprint || source.file !== entry.file || source.symbol !== entry.symbol) {
      throw new M5bInventoryError(`M5B-2 removed source drifted: ${entry.active_id}`)
    }
    if (entry.disposition !== 'REFACTORED_TO_SHARED_TRANSACTION_KERNEL') {
      throw new M5bInventoryError(`M5B-2 removed source lacks exact disposition: ${entry.active_id}`)
    }
  }
  unique(step2SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-2 added fingerprints')
  const classCounts = countBy(step2SourceDelta.added_target, (entry) => entry.target_class)
  assertEqual(classCounts.PRE_GATE_MIGRATION_INTERNAL ?? 0, 3, 'M5B-2 migration-internal additions')
  assertEqual(classCounts.TEST_ONLY_ADAPTER_INFRASTRUCTURE ?? 0, 3, 'M5B-2 adapter additions')
  for (const entry of step2SourceDelta.added_target) {
    if (entry.planned_step !== 'M5B-2') throw new M5bInventoryError(`M5B-2 added target has wrong step: ${entry.fingerprint}`)
  }
}

function validateStep3SourceDeltaFixture(step3SourceDelta, step2SourceDelta) {
  if (step3SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-3 delta schema ${step3SourceDelta.schema_version}`)
  }
  assertEqual(step3SourceDelta.step, 'M5B-3', 'M5B-3 delta step')
  assertEqual(step3SourceDelta.source_digest, step2SourceDelta.target_digest, 'M5B-3 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step3SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-3 target digest')
  assertEqual(step3SourceDelta.removed_source.length, 0, 'M5B-3 removed source count')
  assertEqual(step3SourceDelta.added_target.length, 18, 'M5B-3 added target count')
  unique(step3SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-3 added fingerprints')
  const classCounts = countBy(step3SourceDelta.added_target, (entry) => entry.target_class)
  assertEqual(classCounts.EVENT_BATCH_FILE_CAPABILITY_INTERNAL ?? 0, 17, 'M5B-3 file-capability additions')
  assertEqual(classCounts.LEGACY_REPAIR_INTERNAL ?? 0, 1, 'M5B-3 legacy-repair additions')
  assertExactSet(
    [...new Set(step3SourceDelta.added_target.map((entry) => entry.file))],
    [
      'src/main/domain/event-batch/file-capability.ts',
      'src/main/domain/event-batch/legacy-reader.ts'
    ],
    'M5B-3 added target files'
  )
  for (const entry of step3SourceDelta.added_target) {
    if (entry.planned_step !== 'M5B-3') throw new M5bInventoryError(`M5B-3 added target has wrong step: ${entry.fingerprint}`)
  }
}

function validateStep4SourceDeltaFixture(step4SourceDelta, step3SourceDelta) {
  if (step4SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-4 delta schema ${step4SourceDelta.schema_version}`)
  }
  assertEqual(step4SourceDelta.step, 'M5B-4', 'M5B-4 delta step')
  assertEqual(step4SourceDelta.source_digest, step3SourceDelta.target_digest, 'M5B-4 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step4SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-4 target digest')
  assertEqual(step4SourceDelta.removed_source.length, 0, 'M5B-4 removed source count')
  assertEqual(step4SourceDelta.added_target.length, 3, 'M5B-4 added target count')
  unique(step4SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-4 added fingerprints')
  const classCounts = countBy(step4SourceDelta.added_target, (entry) => entry.target_class)
  assertEqual(classCounts.EVENT_BATCH_COMMAND_STORE_INTERNAL ?? 0, 3, 'M5B-4 command-store additions')
  assertExactSet(
    [...new Set(step4SourceDelta.added_target.map((entry) => entry.file))],
    ['src/main/application/command/durable-command-store.ts'],
    'M5B-4 added target files'
  )
  for (const entry of step4SourceDelta.added_target) {
    if (entry.planned_step !== 'M5B-4') throw new M5bInventoryError(`M5B-4 added target has wrong step: ${entry.fingerprint}`)
  }
}

function validateStep5SourceDeltaFixture(step5SourceDelta, step4SourceDelta) {
  if (step5SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-5 delta schema ${step5SourceDelta.schema_version}`)
  }
  assertEqual(step5SourceDelta.step, 'M5B-5', 'M5B-5 delta step')
  assertEqual(step5SourceDelta.source_digest, step4SourceDelta.target_digest, 'M5B-5 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step5SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-5 target digest')
  assertEqual(step5SourceDelta.removed_source.length, 0, 'M5B-5 removed source count')
  assertEqual(step5SourceDelta.added_target.length, 10, 'M5B-5 added source count')
  assertEqual(step5SourceDelta.capability_removed_source.length, 0, 'M5B-5 removed capability count')
  assertEqual(step5SourceDelta.capability_added_target.length, 1, 'M5B-5 added capability count')
  unique(step5SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-5 added fingerprints')
  unique(
    step5SourceDelta.capability_added_target.map((entry) => entry.fingerprint),
    'M5B-5 added capability fingerprints'
  )
  const classCounts = countBy(step5SourceDelta.added_target, (entry) => entry.target_class)
  assertEqual(classCounts.EVENT_BATCH_COORDINATOR_INTERNAL ?? 0, 1, 'M5B-5 coordinator additions')
  assertEqual(classCounts.EVENT_BATCH_REBUILD_INTERNAL ?? 0, 1, 'M5B-5 rebuild additions')
  assertEqual(classCounts.EVENT_BATCH_PROJECTION_INTERNAL ?? 0, 5, 'M5B-5 projection additions')
  assertEqual(classCounts.EVENT_BATCH_RECOVERY_INTERNAL ?? 0, 3, 'M5B-5 recovery additions')
  assertExactSet(
    [...new Set(step5SourceDelta.added_target.map((entry) => entry.file))],
    [
      'src/main/domain/event-batch/batch-coordinator.ts',
      'src/main/domain/event-batch/mixed-domain-replay.ts',
      'src/main/domain/event-batch/projection-source.ts',
      'src/main/domain/event-batch/startup-recovery.ts'
    ],
    'M5B-5 added target files'
  )
  for (const entry of step5SourceDelta.added_target) {
    if (entry.planned_step !== 'M5B-5') throw new M5bInventoryError(`M5B-5 added target has wrong step: ${entry.fingerprint}`)
  }
  const [capability] = step5SourceDelta.capability_added_target
  assertEqual(
    capability.target_class,
    'EVENT_BATCH_REBUILD_LEGACY_COMPATIBILITY',
    'M5B-5 rebuild compatibility capability class'
  )
  assertEqual(
    capability.file,
    'src/main/domain/event-batch/mixed-domain-replay.ts',
    'M5B-5 rebuild compatibility capability file'
  )
  if (capability.planned_step !== 'M5B-5') {
    throw new M5bInventoryError(`M5B-5 added capability has wrong step: ${capability.fingerprint}`)
  }
}

function validateStep6SourceDeltaFixture(step6SourceDelta, step5SourceDelta) {
  if (step6SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-6 delta schema ${step6SourceDelta.schema_version}`)
  }
  assertEqual(step6SourceDelta.step, 'M5B-6', 'M5B-6 delta step')
  assertEqual(step6SourceDelta.source_digest, step5SourceDelta.target_digest, 'M5B-6 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step6SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-6 target digest')
  assertEqual(step6SourceDelta.removed_source.length, 0, 'M5B-6 removed source count')
  assertEqual(step6SourceDelta.added_target.length, 4, 'M5B-6 added source count')
  assertEqual(step6SourceDelta.capability_removed_source.length, 0, 'M5B-6 removed capability count')
  assertEqual(step6SourceDelta.capability_added_target.length, 0, 'M5B-6 added capability count')
  unique(step6SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-6 added fingerprints')
  assertEqual(
    countBy(step6SourceDelta.added_target, (entry) => entry.target_class).REPORT_CLOSURE_PROJECTOR_INTERNAL ?? 0,
    4,
    'M5B-6 report/closure projector additions'
  )
  assertExactSet(
    [...new Set(step6SourceDelta.added_target.map((entry) => entry.file))],
    ['src/main/domain/projectors/task-closure-projector.ts'],
    'M5B-6 added target files'
  )
  for (const entry of step6SourceDelta.added_target) {
    if (entry.planned_step !== 'M5B-6') throw new M5bInventoryError(`M5B-6 added target has wrong step: ${entry.fingerprint}`)
  }
}

function validateStep7SourceDeltaFixture(step7SourceDelta, step6SourceDelta) {
  if (step7SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-7 delta schema ${step7SourceDelta.schema_version}`)
  }
  assertEqual(step7SourceDelta.step, 'M5B-7', 'M5B-7 delta step')
  assertEqual(step7SourceDelta.source_digest, step6SourceDelta.target_digest, 'M5B-7 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step7SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-7 target digest')
  assertEqual(step7SourceDelta.removed_source.length, 6, 'M5B-7 removed source count')
  assertEqual(step7SourceDelta.added_target.length, 6, 'M5B-7 added target count')
  assertEqual(step7SourceDelta.capability_removed_source.length, 0, 'M5B-7 removed capability count')
  assertEqual(step7SourceDelta.capability_added_target.length, 0, 'M5B-7 added capability count')
  assertExactSet(
    [...new Set(step7SourceDelta.removed_source.map((entry) => entry.file))],
    ['src/main/application/services/student-service.ts'],
    'M5B-7 extracted source file'
  )
  assertExactSet(
    [...new Set(step7SourceDelta.added_target.map((entry) => entry.file))],
    ['src/main/application/services/student-service.ts'],
    'M5B-7 external transaction target file'
  )
  for (const entry of step7SourceDelta.removed_source) {
    if (entry.disposition !== 'EXTRACTED_TO_GATE_ONLY_EXTERNAL_TRANSACTION_APPLY') {
      throw new M5bInventoryError(`M5B-7 removed source lacks exact disposition: ${entry.fingerprint}`)
    }
  }
  for (const entry of step7SourceDelta.added_target) {
    if (entry.target_class !== 'GATE_ONLY_EXTERNAL_TRANSACTION_DML' || entry.planned_step !== 'M5B-7') {
      throw new M5bInventoryError(`M5B-7 added target is not a gate-only external DML: ${entry.fingerprint}`)
    }
  }
}

function validateStep8SourceDeltaFixture(step8SourceDelta, step7SourceDelta) {
  if (step8SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-8 delta schema ${step8SourceDelta.schema_version}`)
  }
  assertEqual(step8SourceDelta.step, 'M5B-8', 'M5B-8 delta step')
  assertEqual(step8SourceDelta.source_digest, step7SourceDelta.target_digest, 'M5B-8 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step8SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-8 target digest')
  assertEqual(step8SourceDelta.removed_source.length, 0, 'M5B-8 removed source count')
  assertEqual(step8SourceDelta.added_target.length, 9, 'M5B-8 added target count')
  assertEqual(step8SourceDelta.capability_removed_source.length, 0, 'M5B-8 removed capability count')
  assertEqual(step8SourceDelta.capability_added_target.length, 0, 'M5B-8 added capability count')
  unique(step8SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-8 added fingerprints')
  assertEqual(
    countBy(step8SourceDelta.added_target, (entry) => entry.target_class).TRAINING_PREPARED_PROJECTOR_INTERNAL ?? 0,
    9,
    'M5B-8 training projector additions'
  )
  assertExactSet(
    [...new Set(step8SourceDelta.added_target.map((entry) => entry.file))],
    ['src/main/domain/projectors/training-projector.ts'],
    'M5B-8 added target files'
  )
  for (const entry of step8SourceDelta.added_target) {
    if (entry.planned_step !== 'M5B-8') throw new M5bInventoryError(`M5B-8 added target has wrong step: ${entry.fingerprint}`)
  }
}

function validateStep9SourceDeltaFixture(step9SourceDelta, step8SourceDelta) {
  if (step9SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-9 delta schema ${step9SourceDelta.schema_version}`)
  }
  assertEqual(step9SourceDelta.step, 'M5B-9', 'M5B-9 delta step')
  assertEqual(step9SourceDelta.source_digest, step8SourceDelta.target_digest, 'M5B-9 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step9SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-9 target digest')
  assertEqual(step9SourceDelta.removed_source.length, 0, 'M5B-9 removed source count')
  assertEqual(step9SourceDelta.capability_removed_source.length, 0, 'M5B-9 removed capability count')
  assertEqual(step9SourceDelta.capability_added_target.length, 0, 'M5B-9 added capability count')
  assertEqual(step9SourceDelta.added_target.length, 0, 'M5B-9 direct mutation additions')
  unique(step9SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-9 added fingerprints')
}

function validateStep10SourceDeltaFixture(step10SourceDelta, step9SourceDelta) {
  if (step10SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-10 delta schema ${step10SourceDelta.schema_version}`)
  }
  assertEqual(step10SourceDelta.step, 'M5B-10', 'M5B-10 delta step')
  assertEqual(step10SourceDelta.source_digest, step9SourceDelta.target_digest, 'M5B-10 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step10SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-10 target digest')
  assertEqual(step10SourceDelta.removed_source.length, 0, 'M5B-10 removed source count')
  assertEqual(step10SourceDelta.capability_removed_source.length, 0, 'M5B-10 removed capability count')
  assertEqual(step10SourceDelta.capability_added_target.length, 0, 'M5B-10 added capability count')
  assertEqual(step10SourceDelta.added_target.length, 0, 'M5B-10 direct mutation additions')
  unique(step10SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-10 added fingerprints')
}

function validateStep11SourceDeltaFixture(step11SourceDelta, step10SourceDelta) {
  if (step11SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-11 delta schema ${step11SourceDelta.schema_version}`)
  }
  assertEqual(step11SourceDelta.step, 'M5B-11', 'M5B-11 delta step')
  assertEqual(step11SourceDelta.source_digest, step10SourceDelta.target_digest, 'M5B-11 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step11SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-11 target digest')
  assertEqual(step11SourceDelta.removed_source.length, 5, 'M5B-11 removed source count')
  assertEqual(step11SourceDelta.capability_removed_source.length, 0, 'M5B-11 removed capability count')
  assertEqual(step11SourceDelta.capability_added_target.length, 0, 'M5B-11 added capability count')
  assertEqual(step11SourceDelta.added_target.length, 5, 'M5B-11 direct mutation additions')
  unique(step11SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-11 added fingerprints')
  assertExactSet(
    [...new Set(step11SourceDelta.removed_source.map((entry) => entry.disposition))],
    ['REFACTORED_TO_PREPARED_RUNTIME_EFFECT'],
    'M5B-11 removed dispositions'
  )
  assertExactSet(
    [...new Set(step11SourceDelta.added_target.map((entry) => entry.target_class))],
    ['ASSIGNMENT_RUNTIME_PREPARED_EFFECT'],
    'M5B-11 added target classes'
  )
  assertExactSet(
    [...new Set(step11SourceDelta.added_target.map((entry) => entry.file))],
    ['src/main/domain/local-runtime-context.ts'],
    'M5B-11 added target files'
  )
}

function validateStep13SourceDeltaFixture(step13SourceDelta, step11SourceDelta) {
  if (step13SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-13 delta schema ${step13SourceDelta.schema_version}`)
  }
  assertEqual(step13SourceDelta.step, 'M5B-13', 'M5B-13 delta step')
  assertEqual(step13SourceDelta.source_digest, step11SourceDelta.target_digest, 'M5B-13 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step13SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-13 target digest')
  assertEqual(step13SourceDelta.removed_source.length, 0, 'M5B-13 removed source count')
  assertEqual(step13SourceDelta.capability_removed_source.length, 0, 'M5B-13 removed capability count')
  assertEqual(step13SourceDelta.capability_added_target.length, 0, 'M5B-13 added capability count')
  assertEqual(step13SourceDelta.added_target.length, 14, 'M5B-13 direct artifact additions')
  unique(step13SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-13 added fingerprints')
  assertExactSet(
    [...new Set(step13SourceDelta.added_target.map((entry) => entry.target_class))],
    ['REPORT_EXPORT_ARTIFACT_PREPARE_EFFECT', 'REPORT_EXPORT_PREPARED_PROJECTOR'],
    'M5B-13 added target classes'
  )
  assertExactSet(
    [...new Set(step13SourceDelta.added_target.map((entry) => entry.file))],
    [
      'src/main/domain/event-batch/artifact-probe.ts',
      'src/main/domain/event-batch/artifact-publisher.ts',
      'src/main/domain/projectors/report-export-projector.ts'
    ],
    'M5B-13 added target files'
  )
}

function validateStep12SourceDeltaFixture(step12SourceDelta, step13SourceDelta) {
  if (step12SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-12 delta schema ${step12SourceDelta.schema_version}`)
  }
  assertEqual(step12SourceDelta.step, 'M5B-12', 'M5B-12 delta step')
  // M5B-13 was completed first so its report artifact boundary remains a fixed prior state.
  assertEqual(step12SourceDelta.source_digest, step13SourceDelta.target_digest, 'M5B-12 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step12SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-12 target digest')
  assertEqual(step12SourceDelta.removed_source.length, 0, 'M5B-12 removed source count')
  assertEqual(step12SourceDelta.capability_removed_source.length, 0, 'M5B-12 removed capability count')
  assertEqual(step12SourceDelta.capability_added_target.length, 0, 'M5B-12 added capability count')
  assertEqual(step12SourceDelta.added_target.length, 8, 'M5B-12 direct safety projector additions')
  unique(step12SourceDelta.added_target.map((entry) => entry.fingerprint), 'M5B-12 added fingerprints')
  assertExactSet(
    [...new Set(step12SourceDelta.added_target.map((entry) => entry.target_class))],
    ['SAFETY_PREPARED_PROJECTOR'],
    'M5B-12 added target classes'
  )
  assertExactSet(
    [...new Set(step12SourceDelta.added_target.map((entry) => entry.file))],
    ['src/main/domain/projectors/safety-projector.ts'],
    'M5B-12 added target files'
  )
}

function validateStep14SourceDeltaFixture(step14SourceDelta, step12SourceDelta) {
  if (step14SourceDelta.schema_version !== M5B_STEP_DELTA_SCHEMA_VERSION) {
    throw new M5bInventoryError(`invalid M5B-14 delta schema ${step14SourceDelta.schema_version}`)
  }
  assertEqual(step14SourceDelta.step, 'M5B-14', 'M5B-14 delta step')
  assertEqual(step14SourceDelta.source_digest, step12SourceDelta.target_digest, 'M5B-14 delta source digest')
  if (!/^[0-9a-f]{64}$/.test(step14SourceDelta.target_digest)) throw new M5bInventoryError('invalid M5B-14 target digest')
  assertEqual(step14SourceDelta.removed_source.length, 3, 'M5B-14 removed direct count')
  assertEqual(step14SourceDelta.added_target.length, 5, 'M5B-14 added direct count')
  assertEqual(step14SourceDelta.capability_removed_source.length, 4, 'M5B-14 removed capability count')
  assertEqual(step14SourceDelta.capability_added_target.length, 2, 'M5B-14 added capability count')
  assertEqual(step14SourceDelta.channel_removed_source.length, 0, 'M5B-14 removed channel count')
  assertEqual(step14SourceDelta.channel_added_target.length, 1, 'M5B-14 added channel count')
  assertEqual(step14SourceDelta.delegating_root_removed_source.length, 1, 'M5B-14 removed delegating root count')
  assertEqual(step14SourceDelta.delegating_root_added_target.length, 2, 'M5B-14 added delegating root count')
  assertExactSet(
    [...new Set(step14SourceDelta.removed_source.map((entry) => entry.disposition))],
    ['RETIRED_LEGACY_STARTUP_RECOVERY'],
    'M5B-14 removed direct dispositions'
  )
  assertExactSet(
    [...new Set(step14SourceDelta.added_target.map((entry) => entry.target_class))],
    ['EVENT_BATCH_STARTUP_RECOVERY', 'M5B_ARCHIVAL_BACKUP', 'PREPARE_ONLY_PLANNING_CLONE', 'TARGET_SCHEMA_CUTOVER'],
    'M5B-14 added direct classes'
  )
  assertExactSet(
    [...new Set(step14SourceDelta.capability_removed_source.map((entry) => entry.disposition))],
    ['RETIRED_LEGACY_STARTUP_RECOVERY', 'RETIRED_REPORT_COORDINATOR_COMPOSITION'],
    'M5B-14 removed capability dispositions'
  )
  assertExactSet(
    [...new Set(step14SourceDelta.capability_added_target.map((entry) => entry.target_class))],
    ['RETAINED_LEGACY_HANDLER_TEST_SEAM_IMPORT'],
    'M5B-14 added capability classes'
  )
  assertExactSet(
    step14SourceDelta.channel_added_target.map((entry) => entry.channel),
    ['runtime:getHealth'],
    'M5B-14 added channels'
  )
  assertExactSet(
    [...new Set(step14SourceDelta.channel_added_target.map((entry) => entry.target_class))],
    ['RUNTIME_HEALTH_READ'],
    'M5B-14 added channel classes'
  )
  assertExactSet(
    step14SourceDelta.delegating_root_removed_source.map((entry) => entry.path),
    ['src/main/application/runtime/application-runtime.ts'],
    'M5B-14 removed delegating roots'
  )
  assertExactSet(
    step14SourceDelta.delegating_root_added_target.map((entry) => entry.path),
    ['src/main/ipc/handlers/reports.ts', 'src/main/ipc/handlers/safety.ts'],
    'M5B-14 added delegating roots'
  )
}

export function validateM5bInventoryDocuments({
  inventory,
  implementationStart,
  step2SourceDelta,
  step3SourceDelta,
  step4SourceDelta,
  step5SourceDelta,
  step6SourceDelta,
  step7SourceDelta,
  step8SourceDelta,
  step9SourceDelta,
  step10SourceDelta,
  step11SourceDelta,
  step13SourceDelta,
  step12SourceDelta,
  step14SourceDelta,
  active,
  mapping
}) {
  if (inventory.schema_version !== M5B_INVENTORY_SCHEMA_VERSION) throw new M5bInventoryError(`invalid inventory schema ${inventory.schema_version}`)
  if (implementationStart.schema_version !== M5B_START_SCHEMA_VERSION) throw new M5bInventoryError(`invalid implementation-start schema ${implementationStart.schema_version}`)
  if (implementationStart.m5a_active_inventory_digest !== M5B_SOURCE_DIGEST) throw new M5bInventoryError('implementation-start M5A digest mismatch')
  if (implementationStart.head_commit !== implementationStart.base_commit) throw new M5bInventoryError('implementation-start head/base mismatch')
  unique(implementationStart.entries.map((entry) => entry.path), 'implementation-start paths')
  unique(implementationStart.index_entries.map((entry) => `${entry.stage}:${entry.path}`), 'implementation-start index entries')
  validateSourceAndTarget(inventory, active, mapping)
  validateStepOrder(inventory)
  validateCommands(inventory, active)
  validateActiveEntries(inventory, active)
  validateMappingAndExceptions(inventory, mapping)
  validateStep2SourceDeltaFixture(step2SourceDelta, active)
  validateStep3SourceDeltaFixture(step3SourceDelta, step2SourceDelta)
  validateStep4SourceDeltaFixture(step4SourceDelta, step3SourceDelta)
  validateStep5SourceDeltaFixture(step5SourceDelta, step4SourceDelta)
  validateStep6SourceDeltaFixture(step6SourceDelta, step5SourceDelta)
  validateStep7SourceDeltaFixture(step7SourceDelta, step6SourceDelta)
  validateStep8SourceDeltaFixture(step8SourceDelta, step7SourceDelta)
  validateStep9SourceDeltaFixture(step9SourceDelta, step8SourceDelta)
  validateStep10SourceDeltaFixture(step10SourceDelta, step9SourceDelta)
  validateStep11SourceDeltaFixture(step11SourceDelta, step10SourceDelta)
  validateStep13SourceDeltaFixture(step13SourceDelta, step11SourceDelta)
  validateStep12SourceDeltaFixture(step12SourceDelta, step13SourceDelta)
  validateStep14SourceDeltaFixture(step14SourceDelta, step12SourceDelta)

  const legacyEventIds = active.capability_callsites.filter((entry) => entry.kind === 'LEGACY_EVENT_PORT_CALL').map((entry) => entry.id)
  const reportCallIds = active.capability_callsites.filter((entry) => entry.kind === 'REPORT_COMMAND_CALL').map((entry) => entry.id)
  assertEqual(legacyEventIds.length, M5B_EXPECTED.legacy_event_ports, 'legacy event-port source count')
  assertEqual(reportCallIds.length, M5B_EXPECTED.request_report_commands, 'request report source count')
  assertExactSet(inventory.expected_pending['M5B-1'].legacy_event_port_ids, legacyEventIds, 'M5B-1 legacy pending IDs')
  assertExactSet(inventory.expected_pending['M5B-1'].request_report_command_ids, reportCallIds, 'M5B-1 report pending IDs')
  assertExactSet(inventory.expected_pending['M5B-1'].command_channels, inventory.commands.map((entry) => entry.channel), 'M5B-1 command pending')
  return inventory
}

function validateStep2CheckoutDelta(scan, active, fixture) {
  assertEqual(scan.digest, fixture.target_digest, 'M5B-2 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, fixture.expected_counts[key], `M5B-2 ${key}`)
  }
  assertExactSet(
    scan.channels.map((entry) => entry.fingerprint),
    active.channels.map((entry) => entry.fingerprint),
    'M5B-2 channels'
  )
  assertExactSet(
    scan.capability_callsites.map((entry) => entry.fingerprint),
    active.capability_callsites.map((entry) => entry.fingerprint),
    'M5B-2 capability callsites'
  )
  const sourceDirect = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  const targetDirect = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet(
    active.direct_callsites.filter((entry) => !targetDirect.has(entry.fingerprint)).map((entry) => entry.fingerprint),
    fixture.removed_source.map((entry) => entry.fingerprint),
    'M5B-2 removed direct callsites'
  )
  const added = scan.direct_callsites.filter((entry) => !sourceDirect.has(entry.fingerprint))
  assertExactSet(
    added.map((entry) => entry.fingerprint),
    fixture.added_target.map((entry) => entry.fingerprint),
    'M5B-2 added direct callsites'
  )
  const fixtureByFingerprint = new Map(fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-2 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep3CheckoutDelta(scan, active, step2Fixture, step3Fixture) {
  assertEqual(scan.digest, step3Fixture.target_digest, 'M5B-3 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step3Fixture.expected_counts[key], `M5B-3 ${key}`)
  }
  assertExactSet(
    scan.channels.map((entry) => entry.fingerprint),
    active.channels.map((entry) => entry.fingerprint),
    'M5B-3 channels'
  )
  assertExactSet(
    scan.capability_callsites.map((entry) => entry.fingerprint),
    active.capability_callsites.map((entry) => entry.fingerprint),
    'M5B-3 capability callsites'
  )
  const step2Removed = new Set(step2Fixture.removed_source.map((entry) => entry.fingerprint))
  const step2Target = new Set([
    ...active.direct_callsites.filter((entry) => !step2Removed.has(entry.fingerprint)).map((entry) => entry.fingerprint),
    ...step2Fixture.added_target.map((entry) => entry.fingerprint)
  ])
  const checkout = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet(
    [...step2Target].filter((fingerprint) => !checkout.has(fingerprint)),
    step3Fixture.removed_source.map((entry) => entry.fingerprint),
    'M5B-3 removed direct callsites'
  )
  const added = scan.direct_callsites.filter((entry) => !step2Target.has(entry.fingerprint))
  assertExactSet(
    added.map((entry) => entry.fingerprint),
    step3Fixture.added_target.map((entry) => entry.fingerprint),
    'M5B-3 added direct callsites'
  )
  const fixtureByFingerprint = new Map(step3Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-3 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep4CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture) {
  assertEqual(scan.digest, step4Fixture.target_digest, 'M5B-4 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step4Fixture.expected_counts[key], `M5B-4 ${key}`)
  }
  assertExactSet(
    scan.channels.map((entry) => entry.fingerprint),
    active.channels.map((entry) => entry.fingerprint),
    'M5B-4 channels'
  )
  assertExactSet(
    scan.capability_callsites.map((entry) => entry.fingerprint),
    active.capability_callsites.map((entry) => entry.fingerprint),
    'M5B-4 capability callsites'
  )
  const step2Removed = new Set(step2Fixture.removed_source.map((entry) => entry.fingerprint))
  const step2Target = new Set([
    ...active.direct_callsites.filter((entry) => !step2Removed.has(entry.fingerprint)).map((entry) => entry.fingerprint),
    ...step2Fixture.added_target.map((entry) => entry.fingerprint)
  ])
  const step3Removed = new Set(step3Fixture.removed_source.map((entry) => entry.fingerprint))
  const step3Target = new Set([
    ...[...step2Target].filter((fingerprint) => !step3Removed.has(fingerprint)),
    ...step3Fixture.added_target.map((entry) => entry.fingerprint)
  ])
  const checkout = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet(
    [...step3Target].filter((fingerprint) => !checkout.has(fingerprint)),
    step4Fixture.removed_source.map((entry) => entry.fingerprint),
    'M5B-4 removed direct callsites'
  )
  const added = scan.direct_callsites.filter((entry) => !step3Target.has(entry.fingerprint))
  assertExactSet(
    added.map((entry) => entry.fingerprint),
    step4Fixture.added_target.map((entry) => entry.fingerprint),
    'M5B-4 added direct callsites'
  )
  const fixtureByFingerprint = new Map(step4Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-4 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep5CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture) {
  assertEqual(scan.digest, step5Fixture.target_digest, 'M5B-5 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step5Fixture.expected_counts[key], `M5B-5 ${key}`)
  }
  assertExactSet(
    scan.channels.map((entry) => entry.fingerprint),
    active.channels.map((entry) => entry.fingerprint),
    'M5B-5 channels'
  )
  const sourceCapabilities = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  const checkoutCapabilities = new Map(scan.capability_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet(
    [...sourceCapabilities].filter((fingerprint) => !checkoutCapabilities.has(fingerprint)),
    step5Fixture.capability_removed_source.map((entry) => entry.fingerprint),
    'M5B-5 removed capability callsites'
  )
  const addedCapabilities = scan.capability_callsites.filter(
    (entry) => !sourceCapabilities.has(entry.fingerprint)
  )
  assertExactSet(
    addedCapabilities.map((entry) => entry.fingerprint),
    step5Fixture.capability_added_target.map((entry) => entry.fingerprint),
    'M5B-5 added capability callsites'
  )
  const capabilityByFingerprint = new Map(
    step5Fixture.capability_added_target.map((entry) => [entry.fingerprint, entry])
  )
  for (const entry of addedCapabilities) {
    const expected = capabilityByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-5 capability ${entry.fingerprint} ${key}`)
    }
  }
  const source = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture]) {
    for (const entry of fixture.removed_source) source.delete(entry.fingerprint)
    for (const entry of fixture.added_target) source.add(entry.fingerprint)
  }
  const checkout = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet(
    [...source].filter((fingerprint) => !checkout.has(fingerprint)),
    step5Fixture.removed_source.map((entry) => entry.fingerprint),
    'M5B-5 removed direct callsites'
  )
  const added = scan.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(
    added.map((entry) => entry.fingerprint),
    step5Fixture.added_target.map((entry) => entry.fingerprint),
    'M5B-5 added direct callsites'
  )
  const fixtureByFingerprint = new Map(step5Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-5 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep6CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture) {
  assertEqual(scan.digest, step6Fixture.target_digest, 'M5B-6 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step6Fixture.expected_counts[key], `M5B-6 ${key}`)
  }
  assertExactSet(
    scan.channels.map((entry) => entry.fingerprint),
    active.channels.map((entry) => entry.fingerprint),
    'M5B-6 channels'
  )
  const sourceCapabilities = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture]) {
    for (const entry of fixture.capability_removed_source ?? []) sourceCapabilities.delete(entry.fingerprint)
    for (const entry of fixture.capability_added_target ?? []) sourceCapabilities.add(entry.fingerprint)
  }
  assertExactSet(
    [...sourceCapabilities],
    scan.capability_callsites.map((entry) => entry.fingerprint),
    'M5B-6 capability callsites'
  )
  const source = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture]) {
    for (const entry of fixture.removed_source) source.delete(entry.fingerprint)
    for (const entry of fixture.added_target) source.add(entry.fingerprint)
  }
  const checkout = new Map(scan.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet(
    [...source].filter((fingerprint) => !checkout.has(fingerprint)),
    step6Fixture.removed_source.map((entry) => entry.fingerprint),
    'M5B-6 removed direct callsites'
  )
  const added = scan.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(
    added.map((entry) => entry.fingerprint),
    step6Fixture.added_target.map((entry) => entry.fingerprint),
    'M5B-6 added direct callsites'
  )
  const fixtureByFingerprint = new Map(step6Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-6 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep7CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture) {
  assertEqual(scan.digest, step7Fixture.target_digest, 'M5B-7 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step7Fixture.expected_counts[key], `M5B-7 ${key}`)
  }
  assertExactSet(scan.channels.map((entry) => entry.fingerprint), active.channels.map((entry) => entry.fingerprint), 'M5B-7 channels')
  const sourceCapabilities = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture]) {
    for (const entry of fixture.capability_removed_source ?? []) sourceCapabilities.delete(entry.fingerprint)
    for (const entry of fixture.capability_added_target ?? []) sourceCapabilities.add(entry.fingerprint)
  }
  assertExactSet([...sourceCapabilities], scan.capability_callsites.map((entry) => entry.fingerprint), 'M5B-7 capability callsites')

  const source = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture]) {
    for (const entry of fixture.removed_source) source.delete(entry.fingerprint)
    for (const entry of fixture.added_target) source.add(entry.fingerprint)
  }
  const checkout = new Set(scan.direct_callsites.map((entry) => entry.fingerprint))
  assertExactSet([...source].filter((fingerprint) => !checkout.has(fingerprint)), step7Fixture.removed_source.map((entry) => entry.fingerprint), 'M5B-7 removed direct callsites')
  const added = scan.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(added.map((entry) => entry.fingerprint), step7Fixture.added_target.map((entry) => entry.fingerprint), 'M5B-7 added direct callsites')
  const fixtureByFingerprint = new Map(step7Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-7 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep8CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture) {
  assertEqual(scan.digest, step8Fixture.target_digest, 'M5B-8 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step8Fixture.expected_counts[key], `M5B-8 ${key}`)
  }
  assertExactSet(scan.channels.map((entry) => entry.fingerprint), active.channels.map((entry) => entry.fingerprint), 'M5B-8 channels')
  const sourceCapabilities = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture]) {
    for (const entry of fixture.capability_removed_source ?? []) sourceCapabilities.delete(entry.fingerprint)
    for (const entry of fixture.capability_added_target ?? []) sourceCapabilities.add(entry.fingerprint)
  }
  assertExactSet([...sourceCapabilities], scan.capability_callsites.map((entry) => entry.fingerprint), 'M5B-8 capability callsites')
  const source = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture]) {
    for (const entry of fixture.removed_source) source.delete(entry.fingerprint)
    for (const entry of fixture.added_target) source.add(entry.fingerprint)
  }
  const checkout = new Set(scan.direct_callsites.map((entry) => entry.fingerprint))
  assertExactSet([...source].filter((fingerprint) => !checkout.has(fingerprint)), step8Fixture.removed_source.map((entry) => entry.fingerprint), 'M5B-8 removed direct callsites')
  const added = scan.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(added.map((entry) => entry.fingerprint), step8Fixture.added_target.map((entry) => entry.fingerprint), 'M5B-8 added direct callsites')
  const fixtureByFingerprint = new Map(step8Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-8 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep9CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture, step9Fixture) {
  assertEqual(scan.digest, step9Fixture.target_digest, 'M5B-9 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step9Fixture.expected_counts[key], `M5B-9 ${key}`)
  }
  assertExactSet(scan.channels.map((entry) => entry.fingerprint), active.channels.map((entry) => entry.fingerprint), 'M5B-9 channels')
  const sourceCapabilities = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture, step9Fixture]) {
    for (const entry of fixture.capability_removed_source ?? []) sourceCapabilities.delete(entry.fingerprint)
    for (const entry of fixture.capability_added_target ?? []) sourceCapabilities.add(entry.fingerprint)
  }
  assertExactSet([...sourceCapabilities], scan.capability_callsites.map((entry) => entry.fingerprint), 'M5B-9 capability callsites')
  const source = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture]) {
    for (const entry of fixture.removed_source) source.delete(entry.fingerprint)
    for (const entry of fixture.added_target) source.add(entry.fingerprint)
  }
  const checkout = new Set(scan.direct_callsites.map((entry) => entry.fingerprint))
  assertExactSet([...source].filter((fingerprint) => !checkout.has(fingerprint)), step9Fixture.removed_source.map((entry) => entry.fingerprint), 'M5B-9 removed direct callsites')
  const added = scan.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(added.map((entry) => entry.fingerprint), step9Fixture.added_target.map((entry) => entry.fingerprint), 'M5B-9 added direct callsites')
  const fixtureByFingerprint = new Map(step9Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-9 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep10CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture, step9Fixture, step10Fixture) {
  assertEqual(scan.digest, step10Fixture.target_digest, 'M5B-10 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step10Fixture.expected_counts[key], `M5B-10 ${key}`)
  }
  assertExactSet(scan.channels.map((entry) => entry.fingerprint), active.channels.map((entry) => entry.fingerprint), 'M5B-10 channels')
  const sourceCapabilities = new Set(active.capability_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture, step9Fixture]) {
    for (const entry of fixture.capability_removed_source ?? []) sourceCapabilities.delete(entry.fingerprint)
    for (const entry of fixture.capability_added_target ?? []) sourceCapabilities.add(entry.fingerprint)
  }
  assertExactSet([...sourceCapabilities], scan.capability_callsites.map((entry) => entry.fingerprint), 'M5B-10 capability callsites')
  const source = new Set(active.direct_callsites.map((entry) => entry.fingerprint))
  for (const fixture of [step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture, step9Fixture]) {
    for (const entry of fixture.removed_source) source.delete(entry.fingerprint)
    for (const entry of fixture.added_target) source.add(entry.fingerprint)
  }
  const checkout = new Set(scan.direct_callsites.map((entry) => entry.fingerprint))
  assertExactSet([...source].filter((fingerprint) => !checkout.has(fingerprint)), step10Fixture.removed_source.map((entry) => entry.fingerprint), 'M5B-10 removed direct callsites')
  const added = scan.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(added.map((entry) => entry.fingerprint), step10Fixture.added_target.map((entry) => entry.fingerprint), 'M5B-10 added direct callsites')
  const fixtureByFingerprint = new Map(step10Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-10 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep11CheckoutDelta(scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture, step7Fixture, step8Fixture, step9Fixture, step10Fixture, step11Fixture) {
  validateStep10CheckoutDelta(
    scan, active, step2Fixture, step3Fixture, step4Fixture, step5Fixture, step6Fixture,
    step7Fixture, step8Fixture, step9Fixture, step11Fixture
  )
  assertEqual(step11Fixture.source_digest, step10Fixture.target_digest, 'M5B-11 checkout source digest')
}

function directEntriesAfter(active, fixtures) {
  const entries = new Map(active.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  for (const fixture of fixtures) {
    for (const entry of fixture.removed_source) entries.delete(entry.fingerprint)
    for (const entry of fixture.added_target) entries.set(entry.fingerprint, entry)
  }
  return entries
}

export function scanBeforeM5bDirectAdditions(scan, fixtures) {
  const added = new Set(fixtures.flatMap((fixture) => fixture.added_target.map((entry) => entry.fingerprint)))
  const directCallsites = scan.direct_callsites.filter((entry) => !added.has(entry.fingerprint))
  const directFiles = [...new Set(directCallsites.map((entry) => entry.file))].sort()
  const historical = { ...scan, direct_callsites: directCallsites, direct_files: directFiles }
  return { ...historical, digest: m5aInventoryDigest(historical) }
}

function restoreEntries(entries, removedSource, addedTarget) {
  const restored = new Map(entries.map((entry) => [entry.fingerprint, entry]))
  for (const entry of addedTarget ?? []) restored.delete(entry.fingerprint)
  for (const entry of removedSource ?? []) restored.set(entry.fingerprint, entry)
  return [...restored.values()].sort((left, right) =>
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.kind.localeCompare(right.kind)
    || left.fingerprint.localeCompare(right.fingerprint)
  )
}

function restoreDelegatingRoots(roots, removedSource, addedTarget) {
  const restored = new Set(roots)
  for (const entry of addedTarget ?? []) restored.delete(entry.path)
  for (const entry of removedSource ?? []) restored.add(entry.path)
  return [...restored].sort()
}

/** Reconstructs a reviewed source state by reversing later frozen source deltas. */
export function scanBeforeM5bSourceDeltas(scan, fixtures) {
  let historical = scan
  for (const fixture of [...fixtures].reverse()) {
    const directCallsites = restoreEntries(
      historical.direct_callsites,
      fixture.removed_source,
      fixture.added_target
    )
    const capabilityCallsites = restoreEntries(
      historical.capability_callsites,
      fixture.capability_removed_source,
      fixture.capability_added_target
    )
    const channels = restoreEntries(
      historical.channels,
      fixture.channel_removed_source,
      fixture.channel_added_target
    )
    const delegatingRoots = restoreDelegatingRoots(
      historical.delegating_roots,
      fixture.delegating_root_removed_source,
      fixture.delegating_root_added_target
    )
    historical = {
      ...historical,
      channels: channels.sort((left, right) =>
        (left.channel ?? '').localeCompare(right.channel ?? '') || left.file.localeCompare(right.file)
      ),
      direct_callsites: directCallsites,
      direct_files: [...new Set(directCallsites.map((entry) => entry.file))].sort(),
      capability_callsites: capabilityCallsites,
      delegating_roots: delegatingRoots
    }
  }
  return { ...historical, digest: m5aInventoryDigest(historical) }
}

function validateStep13CheckoutDelta(scan, active, fixtures, step13Fixture, laterFixtures = []) {
  const historical = scanBeforeM5bSourceDeltas(scan, laterFixtures)
  assertEqual(historical.digest, step13Fixture.target_digest, 'M5B-13 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: historical.channels.length,
    direct_callsites: historical.direct_callsites.length,
    direct_files: historical.direct_files.length,
    capability_callsites: historical.capability_callsites.length,
    delegating_roots: historical.delegating_roots.length
  })) {
    assertEqual(actual, step13Fixture.expected_counts[key], `M5B-13 ${key}`)
  }
  assertExactSet(historical.channels.map((entry) => entry.fingerprint), active.channels.map((entry) => entry.fingerprint), 'M5B-13 channels')
  const source = directEntriesAfter(active, fixtures)
  const checkout = new Map(historical.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet([...source.keys()].filter((fingerprint) => !checkout.has(fingerprint)), step13Fixture.removed_source.map((entry) => entry.fingerprint), 'M5B-13 removed direct callsites')
  const added = historical.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(added.map((entry) => entry.fingerprint), step13Fixture.added_target.map((entry) => entry.fingerprint), 'M5B-13 added direct callsites')
  const fixtureByFingerprint = new Map(step13Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-13 ${entry.fingerprint} ${key}`)
    }
  }
}

function validateStep12CheckoutDelta(scan, active, fixtures, step12Fixture, laterFixtures = []) {
  const historical = scanBeforeM5bSourceDeltas(scan, laterFixtures)
  assertEqual(historical.digest, step12Fixture.target_digest, 'M5B-12 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: historical.channels.length,
    direct_callsites: historical.direct_callsites.length,
    direct_files: historical.direct_files.length,
    capability_callsites: historical.capability_callsites.length,
    delegating_roots: historical.delegating_roots.length
  })) {
    assertEqual(actual, step12Fixture.expected_counts[key], `M5B-12 ${key}`)
  }
  assertExactSet(historical.channels.map((entry) => entry.fingerprint), active.channels.map((entry) => entry.fingerprint), 'M5B-12 channels')
  const source = directEntriesAfter(active, fixtures)
  const checkout = new Map(historical.direct_callsites.map((entry) => [entry.fingerprint, entry]))
  assertExactSet([...source.keys()].filter((fingerprint) => !checkout.has(fingerprint)), step12Fixture.removed_source.map((entry) => entry.fingerprint), 'M5B-12 removed direct callsites')
  const added = historical.direct_callsites.filter((entry) => !source.has(entry.fingerprint))
  assertExactSet(added.map((entry) => entry.fingerprint), step12Fixture.added_target.map((entry) => entry.fingerprint), 'M5B-12 added direct callsites')
  const fixtureByFingerprint = new Map(step12Fixture.added_target.map((entry) => [entry.fingerprint, entry]))
  for (const entry of added) {
    const expected = fixtureByFingerprint.get(entry.fingerprint)
    for (const key of ['file', 'symbol', 'line', 'kind', 'callee', 'occurrence']) {
      assertEqual(entry[key], expected[key], `M5B-12 ${entry.fingerprint} ${key}`)
    }
  }
}

function capabilityEntriesAfter(active, fixtures) {
  const entries = new Map(active.capability_callsites.map((entry) => [entry.fingerprint, entry]))
  for (const fixture of fixtures) {
    for (const entry of fixture.capability_removed_source ?? []) entries.delete(entry.fingerprint)
    for (const entry of fixture.capability_added_target ?? []) entries.set(entry.fingerprint, entry)
  }
  return entries
}

function channelEntriesAfter(active, fixtures) {
  const entries = new Map(active.channels.map((entry) => [entry.fingerprint, entry]))
  for (const fixture of fixtures) {
    for (const entry of fixture.channel_removed_source ?? []) entries.delete(entry.fingerprint)
    for (const entry of fixture.channel_added_target ?? []) entries.set(entry.fingerprint, entry)
  }
  return entries
}

function validateStep14CheckoutDelta(scan, active, fixtures, step14Fixture) {
  assertEqual(scan.digest, step14Fixture.target_digest, 'M5B-14 checkout digest')
  for (const [key, actual] of Object.entries({
    channels: scan.channels.length,
    direct_callsites: scan.direct_callsites.length,
    direct_files: scan.direct_files.length,
    capability_callsites: scan.capability_callsites.length,
    delegating_roots: scan.delegating_roots.length
  })) {
    assertEqual(actual, step14Fixture.expected_counts[key], `M5B-14 ${key}`)
  }
  const checks = [
    ['direct callsites', directEntriesAfter(active, fixtures), scan.direct_callsites, step14Fixture.removed_source, step14Fixture.added_target],
    ['capability callsites', capabilityEntriesAfter(active, fixtures), scan.capability_callsites, step14Fixture.capability_removed_source, step14Fixture.capability_added_target],
    ['channels', channelEntriesAfter(active, fixtures), scan.channels, step14Fixture.channel_removed_source, step14Fixture.channel_added_target]
  ]
  for (const [label, source, checkoutEntries, removedSource, addedTarget] of checks) {
    const checkout = new Map(checkoutEntries.map((entry) => [entry.fingerprint, entry]))
    assertExactSet(
      [...source.keys()].filter((fingerprint) => !checkout.has(fingerprint)),
      removedSource.map((entry) => entry.fingerprint),
      `M5B-14 removed ${label}`
    )
    assertExactSet(
      checkoutEntries.filter((entry) => !source.has(entry.fingerprint)).map((entry) => entry.fingerprint),
      addedTarget.map((entry) => entry.fingerprint),
      `M5B-14 added ${label}`
    )
  }
  assertExactSet(
    scan.delegating_roots.filter((path) => !new Set(active.delegating_roots.map((entry) => entry.path)).has(path)),
    step14Fixture.delegating_root_added_target.map((entry) => entry.path),
    'M5B-14 added delegating roots'
  )
  assertExactSet(
    active.delegating_roots.map((entry) => entry.path).filter((path) => !new Set(scan.delegating_roots).has(path)),
    step14Fixture.delegating_root_removed_source.map((entry) => entry.path),
    'M5B-14 removed delegating roots'
  )
}

export function scanM5bCheckout(projectRoot) {
  const scan = scanM5aCheckout(projectRoot)
  const productionFiles = scanM5bProductionReachability(projectRoot)
  const productionCapabilities = scan.capability_callsites.filter((entry) => productionFiles.has(entry.file))
  return {
    ...scan,
    production_reachable_files: [...productionFiles].sort(),
    production_capability_callsites: productionCapabilities.filter((entry) => !PREPARE_ONLY_LEGACY_ORACLE_FILES.has(entry.file)),
    production_prepare_oracle_callsites: productionCapabilities.filter((entry) => PREPARE_ONLY_LEGACY_ORACLE_FILES.has(entry.file)),
    digest: m5aInventoryDigest(scan)
  }
}

export function validateM5bBaseline(documents) {
  const inventory = validateM5bInventoryDocuments(documents)
  return {
    channels: inventory.target.invoke_channels,
    reads: inventory.target.reads,
    mutations: inventory.target.mutations,
    batch: inventory.target.batch_domain_mutations,
    gate: inventory.target.gate_only_mutations,
    active_entries: inventory.active_entries.length,
    mapping_entries: inventory.mapping_entries.length,
    exceptions: inventory.exceptions.length
  }
}

export function validateM5bMigration({ scan, step, target = false, ...documents }) {
  const inventory = validateM5bInventoryDocuments(documents)
  let validatedDigest = scan.digest
  if (!inventory.step_order.includes(step)) throw new M5bInventoryError(`unknown migration step ${step}`)
  if (step === 'M5B-1' && scan.digest !== M5B_SOURCE_DIGEST) {
    throw new M5bInventoryError(`M5B-1 checkout digest drifted: expected ${M5B_SOURCE_DIGEST}, got ${scan.digest}`)
  }
  if (step === 'M5B-2') validateStep2CheckoutDelta(scan, documents.active, documents.step2SourceDelta)
  if (step === 'M5B-3') {
    validateStep3CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta
    )
  }
  if (step === 'M5B-4') {
    validateStep4CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta
    )
  }
  if (step === 'M5B-5') {
    validateStep5CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta,
      documents.step5SourceDelta
    )
  }
  if (step === 'M5B-6') {
    validateStep6CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta,
      documents.step5SourceDelta,
      documents.step6SourceDelta
    )
  }
  if (step === 'M5B-7') {
    validateStep7CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta,
      documents.step5SourceDelta,
      documents.step6SourceDelta,
      documents.step7SourceDelta
    )
  }
  if (step === 'M5B-8') {
    validateStep8CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta,
      documents.step5SourceDelta,
      documents.step6SourceDelta,
      documents.step7SourceDelta,
      documents.step8SourceDelta
    )
  }
  if (step === 'M5B-9') {
    validateStep9CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta,
      documents.step5SourceDelta,
      documents.step6SourceDelta,
      documents.step7SourceDelta,
      documents.step8SourceDelta,
      documents.step9SourceDelta
    )
  }
  if (step === 'M5B-10') {
    validateStep10CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta,
      documents.step5SourceDelta,
      documents.step6SourceDelta,
      documents.step7SourceDelta,
      documents.step8SourceDelta,
      documents.step9SourceDelta,
      documents.step10SourceDelta
    )
  }
  if (step === 'M5B-11') {
    validateStep11CheckoutDelta(
      scan,
      documents.active,
      documents.step2SourceDelta,
      documents.step3SourceDelta,
      documents.step4SourceDelta,
      documents.step5SourceDelta,
      documents.step6SourceDelta,
      documents.step7SourceDelta,
      documents.step8SourceDelta,
      documents.step9SourceDelta,
      documents.step10SourceDelta,
      documents.step11SourceDelta
    )
  }
  if (step === 'M5B-13') {
    validateStep13CheckoutDelta(
      scan,
      documents.active,
      [
        documents.step2SourceDelta, documents.step3SourceDelta, documents.step4SourceDelta,
        documents.step5SourceDelta, documents.step6SourceDelta, documents.step7SourceDelta,
        documents.step8SourceDelta, documents.step9SourceDelta, documents.step10SourceDelta,
        documents.step11SourceDelta
      ],
      documents.step13SourceDelta,
      [documents.step12SourceDelta, documents.step14SourceDelta]
    )
    validatedDigest = documents.step13SourceDelta.target_digest
  }
  if (step === 'M5B-12') {
    validateStep12CheckoutDelta(
      scan,
      documents.active,
      [
        documents.step2SourceDelta, documents.step3SourceDelta, documents.step4SourceDelta,
        documents.step5SourceDelta, documents.step6SourceDelta, documents.step7SourceDelta,
        documents.step8SourceDelta, documents.step9SourceDelta, documents.step10SourceDelta,
        documents.step11SourceDelta, documents.step13SourceDelta
      ],
      documents.step12SourceDelta,
      [documents.step14SourceDelta]
    )
    validatedDigest = documents.step12SourceDelta.target_digest
  }
  if (step === 'M5B-14') {
    validateStep14CheckoutDelta(
      scan,
      documents.active,
      [
        documents.step2SourceDelta, documents.step3SourceDelta, documents.step4SourceDelta,
        documents.step5SourceDelta, documents.step6SourceDelta, documents.step7SourceDelta,
        documents.step8SourceDelta, documents.step9SourceDelta, documents.step10SourceDelta,
        documents.step11SourceDelta, documents.step13SourceDelta, documents.step12SourceDelta
      ],
      documents.step14SourceDelta
    )
    validatedDigest = documents.step14SourceDelta.target_digest
  }

  const pending = inventory.expected_pending[step]
  if (target) {
    const actualChannels = scan.channels.map((entry) => entry.channel)
    const targetChannels = [
      ...inventory.target.existing_read_channels,
      ...inventory.target.new_read_channels,
      ...inventory.commands.map((entry) => entry.channel)
    ]
    assertExactSet(actualChannels, targetChannels, 'target checkout channels')
    if (pending.command_channels.length > 0 || pending.runtime_health_channel || pending.legacy_event_port_ids.length > 0 || pending.request_report_command_ids.length > 0) {
      throw new M5bInventoryError(`target pending is not zero at ${step}`)
    }
    const productionCapabilities = scan.production_capability_callsites ?? scan.capability_callsites
    const legacyActual = productionCapabilities.filter((entry) => entry.kind === 'LEGACY_EVENT_PORT_CALL')
    const reportActual = productionCapabilities.filter((entry) => entry.kind === 'REPORT_COMMAND_CALL')
    assertEqual(legacyActual.length, 0, 'target legacy event-port callsites')
    assertEqual(reportActual.length, 0, 'target request report command callsites')
    const oracleCallsites = scan.production_prepare_oracle_callsites ?? []
    const allowedOracleFingerprints = new Set(
      documents.active.capability_callsites
        .filter((entry) => PREPARE_ONLY_LEGACY_ORACLE_FILES.has(entry.file))
        .map((entry) => entry.fingerprint)
    )
    for (const entry of oracleCallsites) {
      if (!allowedOracleFingerprints.has(entry.fingerprint)) {
        throw new M5bInventoryError(`unexpected legacy prepare oracle callsite ${entry.file}:${entry.line}`)
      }
    }
  }

  return {
    channels: target ? scan.channels.length : inventory.target.invoke_channels,
    reads: inventory.target.reads,
    mutations: inventory.target.mutations,
    batch: inventory.target.batch_domain_mutations,
    gate: inventory.target.gate_only_mutations,
    active_entries: inventory.active_entries.length,
    mapping_entries: inventory.mapping_entries.length,
    exceptions: inventory.exceptions.length,
    command_pending: pending.command_channels.length,
    health_pending: pending.runtime_health_channel ? 1 : 0,
    legacy_pending: pending.legacy_event_port_ids.length,
    report_pending: pending.request_report_command_ids.length,
    digest: validatedDigest
  }
}
