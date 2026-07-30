import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { M5B_START_SCHEMA_VERSION } from './m5b-runtime-inventory.mjs'

const STEP_ORDER = Object.freeze(Array.from({ length: 15 }, (_, index) => `M5B-${index + 1}`))

const STEP1_ALLOWED = Object.freeze([
  'package.json',
  'doc/features/event-batch-v2.2-runtime-impl.md',
  'doc/features/event-batch-v2.2-runtime-impl-review.md',
  'doc/features/event-batch-v2.2-runtime-validation.md',
  'doc/index.md',
  'scripts/check-m5b-event-batch.mjs',
  'scripts/update-m5b-step1-fixtures.mjs',
  'scripts/verify-m5b-contract-scope.mjs',
  'scripts/fixtures/m5b-command-runtime-inventory-v1.json',
  'scripts/fixtures/m5b-implementation-start-v1.json',
  'scripts/lib/m5b-contract-scope.mjs',
  'scripts/lib/m5b-isolated-paths.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/__tests__/m5b-contract-scope.test.mjs',
  'scripts/__tests__/m5b-isolated-paths.test.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs'
])

const STEP2_ALLOWED = Object.freeze([
  ...STEP1_ALLOWED,
  'scripts/fixtures/m5b-step2-source-delta-v1.json',
  'scripts/lib/m5b-isolated-db.mjs',
  'scripts/update-m5b-step2-fixture.mjs',
  'scripts/verify-m5b-isolated-db.mjs',
  'scripts/__tests__/m5b-isolated-db.test.mjs',
  'src/main/application/services/__tests__/reports-command-bus.test.ts',
  'src/main/db/__tests__/event-batch-migration.test.ts',
  'src/main/db/__tests__/safety-rekey-migration.test.ts',
  'src/main/db/event-batch-migration.ts',
  'src/main/db/interface.ts',
  'src/main/db/memory-adapter.ts',
  'src/main/db/sqlite-adapter.ts',
  'src/main/domain/__tests__/report-coordinator.test.ts',
  'src/main/domain/__tests__/report-export.test.ts',
  'src/main/ipc/handlers/__tests__/auth.test.ts'
])

const STEP3_ALLOWED = Object.freeze([
  ...STEP2_ALLOWED,
  'scripts/lib/m5a-command-boundary-inventory.mjs',
  'scripts/fixtures/m5b-event-batch-golden-v1.json',
  'scripts/fixtures/m5b-step3-source-delta-v1.json',
  'scripts/update-m5b-step3-fixture.mjs',
  'src/main/domain/event-batch/batch-hash.ts',
  'src/main/domain/event-batch/canonical-json.ts',
  'src/main/domain/event-batch/file-capability.ts',
  'src/main/domain/event-batch/legacy-anchor.ts',
  'src/main/domain/event-batch/legacy-reader.ts',
  'src/main/domain/event-batch/record-types.ts',
  'src/main/domain/event-batch/segment-index.ts',
  'src/main/domain/event-batch/segment-store.ts',
  'src/main/domain/event-batch/__tests__/batch-hash.test.ts',
  'src/main/domain/event-batch/__tests__/canonical-json.test.ts',
  'src/main/domain/event-batch/__tests__/file-capability.test.ts',
  'src/main/domain/event-batch/__tests__/legacy-reader.test.ts',
  'src/main/domain/event-batch/__tests__/segment-index.test.ts',
  'src/main/domain/event-batch/__tests__/segment-store.test.ts'
])

const STEP4_ALLOWED = Object.freeze([
  ...STEP3_ALLOWED,
  'scripts/fixtures/m5b-step4-source-delta-v1.json',
  'scripts/update-m5b-step4-fixture.mjs',
  'src/shared/types/command-transport.ts',
  'src/main/application/command/command-request-hash.ts',
  'src/main/application/command/command-result.ts',
  'src/main/application/command/durable-command-store.ts',
  'src/main/application/command/durable-command-coordinator.ts',
  'src/main/application/command/__tests__/request-hash.test.ts',
  'src/main/application/command/__tests__/durable-command-store.test.ts',
  'src/main/application/command/__tests__/durable-command-coordinator.test.ts',
  'src/main/application/command/__tests__/envelope-v2.test.ts',
  'src/main/application/command/command-types.ts',
  'src/main/application/command/command-registry.ts',
  'src/main/application/command/command-envelope.ts',
  'src/main/application/command/m5a-command-definitions.ts',
  'src/main/application/command/__tests__/command-registry.test.ts',
  'src/main/application/command/__tests__/command-bus.test.ts'
])

const STEP5_ALLOWED = Object.freeze([
  ...STEP4_ALLOWED,
  'scripts/fixtures/m5b-crash-matrix-v1.json',
  'scripts/fixtures/m5b-step5-source-delta-v1.json',
  'scripts/update-m5b-step5-fixture.mjs',
  'src/main/domain/event-batch/batch-coordinator.ts',
  'src/main/domain/event-batch/command-plan.ts',
  'src/main/domain/event-batch/fault-injection.ts',
  'src/main/domain/event-batch/mixed-domain-replay.ts',
  'src/main/domain/event-batch/projection-source.ts',
  'src/main/domain/event-batch/result-registry.ts',
  'src/main/domain/event-batch/runtime-corruption.ts',
  'src/main/domain/event-batch/startup-recovery.ts',
  'src/main/domain/event-batch/writer-mutex.ts',
  'src/main/domain/event-batch/__tests__/batch-coordinator.test.ts',
  'src/main/domain/event-batch/__tests__/command-differential-harness.ts',
  'src/main/domain/event-batch/__tests__/command-differential-harness.test.ts',
  'src/main/domain/event-batch/__tests__/coordinator-test-support.ts',
  'src/main/domain/event-batch/__tests__/fault-matrix.test.ts',
  'src/main/domain/event-batch/__tests__/fencing.test.ts',
  'src/main/domain/event-batch/__tests__/mixed-domain-replay.test.ts',
  'src/main/domain/event-batch/__tests__/projection-source.test.ts',
  'src/main/domain/event-batch/__tests__/startup-recovery.test.ts',
  'src/main/domain/event-batch/__tests__/tamper-recovery.test.ts'
])

const STEP6_ALLOWED = Object.freeze([
  ...STEP5_ALLOWED,
  '.continue-here.md',
  'doc/会话启动.md',
  'doc/features/event-batch-v2.2-runtime-validation.md',
  'doc/features/event-batch-v2.2-runtime-m5b6-r3-review.md',
  'scripts/fixtures/m5b-report-plans-v1.json',
  'scripts/fixtures/m5b-step6-source-delta-v1.json',
  'scripts/update-m5b-step6-fixture.mjs',
  'src/shared/types/event-payloads.ts',
  'src/main/application/planners/report-plan-fragment.ts',
  'src/main/application/planners/report-planner.ts',
  'src/main/application/planners/task-closure-planner.ts',
  'src/main/application/planners/__tests__/report-test-support.ts',
  'src/main/application/planners/__tests__/report-planner.test.ts',
  'src/main/domain/projectors/report-projector.ts',
  'src/main/domain/projectors/task-closure-projector.ts',
  'src/main/domain/projectors/__tests__/report-projector.test.ts',
  'src/main/domain/projectors/__tests__/report-differential.test.ts'
])

const STEP7_ALLOWED = Object.freeze([
  ...STEP6_ALLOWED,
  'scripts/fixtures/m5b-step7-source-delta-v1.json',
  'scripts/update-m5b-step7-fixture.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/lib/m5b-isolated-db.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/main/application/command/gate-only-executor.ts',
  'src/main/application/command/gate-only-command-apply.ts',
  'src/main/application/command/durable-command-coordinator.ts',
  'src/main/application/command/durable-command-store.ts',
  'src/main/application/command/__tests__/gate-only-executor.test.ts',
  'src/main/application/services/gate-only-transaction.ts',
  'src/main/application/services/auth-service.ts',
  'src/main/application/services/student-service.ts',
  'src/main/application/services/strategy-service.ts',
  'src/main/utils/auth-session.ts'
])

const STEP8_ALLOWED = Object.freeze([
  ...STEP7_ALLOWED,
  'scripts/fixtures/m5b-step8-source-delta-v1.json',
  'scripts/update-m5b-step8-fixture.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/main/application/planners/training-planner.ts',
  'src/main/application/planners/__tests__/training-test-support.ts',
  'src/main/application/planners/__tests__/training-planner.test.ts',
  'src/main/domain/projectors/training-projector.ts',
  'src/main/domain/projectors/__tests__/training-projector.test.ts'
])

const STEP9_ALLOWED = Object.freeze([
  ...STEP8_ALLOWED,
  'doc/features/multi-device-m4-safety-sql-inventory-v1.json',
  'doc/features/event-batch-v2.2-runtime-m5b9-r3-review.md',
  'scripts/__tests__/m5a-command-boundary-inventory.test.mjs',
  'scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs',
  'scripts/fixtures/m5b-step9-source-delta-v1.json',
  'scripts/update-m5b-step9-fixture.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/main/application/planners/assessment-planner.ts',
  'src/main/application/planners/__tests__/assessment-test-support.ts',
  'src/main/application/planners/__tests__/assessment-planner.test.ts',
  'src/main/domain/projectors/assessment-projector.ts',
  'src/main/domain/projectors/__tests__/assessment-projector.test.ts'
])

const NEVER_ALLOWED = Object.freeze([
  'package-lock.json'
])

function runGit(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'buffer',
    shell: false,
    maxBuffer: 64 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new M5bContractScopeError(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`)
  }
  return result.stdout
}

function parseZeroList(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function currentEntry(projectRoot, path, sourceKind) {
  const absolutePath = resolve(projectRoot, path)
  let stat
  try {
    stat = lstatSync(absolutePath)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { path, source_kind: sourceKind, file_type: 'MISSING', size: 0, sha256: null }
    }
    throw error
  }
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(absolutePath)
    return { path, source_kind: sourceKind, file_type: 'SYMLINK', size: Buffer.byteLength(target), sha256: sha256(Buffer.from(target, 'utf8')) }
  }
  if (!stat.isFile()) return { path, source_kind: sourceKind, file_type: 'OTHER', size: stat.size, sha256: null }
  const bytes = readFileSync(absolutePath)
  return { path, source_kind: sourceKind, file_type: 'FILE', size: bytes.length, sha256: sha256(bytes) }
}

function parseIndexEntries(buffer) {
  return parseZeroList(buffer).map((entry) => {
    const match = /^(\d+) ([0-9a-f]+) (\d)\t(.+)$/.exec(entry)
    if (!match) throw new M5bContractScopeError(`unexpected git index entry: ${entry}`)
    return { path: match[4], mode: match[1], blob: match[2], stage: Number(match[3]) }
  }).sort((left, right) => `${left.stage}:${left.path}`.localeCompare(`${right.stage}:${right.path}`))
}

function entryEqual(left, right) {
  return left.source_kind === right.source_kind
    && left.file_type === right.file_type
    && left.size === right.size
    && left.sha256 === right.sha256
}

function indexEntryKey(entry) {
  return `${entry.stage}:${entry.path}:${entry.mode}:${entry.blob}`
}

export function allowedM5bPathsForStep(step) {
  if (!STEP_ORDER.includes(step)) throw new M5bContractScopeError(`unknown step ${step}`)
  if (step === 'M5B-1') return new Set(STEP1_ALLOWED)
  if (step === 'M5B-2') return new Set(STEP2_ALLOWED)
  if (step === 'M5B-3') return new Set(STEP3_ALLOWED)
  if (step === 'M5B-4') return new Set(STEP4_ALLOWED)
  if (step === 'M5B-5') return new Set(STEP5_ALLOWED)
  if (step === 'M5B-6') return new Set(STEP6_ALLOWED)
  if (step === 'M5B-7') return new Set(STEP7_ALLOWED)
  if (step === 'M5B-8') return new Set(STEP8_ALLOWED)
  if (step === 'M5B-9') return new Set(STEP9_ALLOWED)
  if (!['M5B-1', 'M5B-2', 'M5B-3', 'M5B-4', 'M5B-5', 'M5B-6', 'M5B-7', 'M5B-8', 'M5B-9'].includes(step)) {
    throw new M5bContractScopeError(`${step} scope allowlist is not implemented yet; update it in that atomic step before editing production files`)
  }
  throw new M5bContractScopeError(`unreachable scope step ${step}`)
}

export function compareM5bWorktreeSnapshot({ baselineEntries, currentEntries, allowedPaths }) {
  const baseline = new Map(baselineEntries.map((entry) => [entry.path, entry]))
  const current = new Map(currentEntries.map((entry) => [entry.path, entry]))
  const preserved = []
  const m5bChanges = []
  const violations = []
  const allPaths = [...new Set([...baseline.keys(), ...current.keys()])].sort()

  for (const path of allPaths) {
    const before = baseline.get(path)
    const after = current.get(path)
    const allowed = allowedPaths.has(path)
    if (NEVER_ALLOWED.includes(path) && (!before || !after || !entryEqual(before, after))) {
      violations.push({ layer: 'working-tree', path, reason: 'NEVER_ALLOWED' })
      continue
    }
    if (before && after && entryEqual(before, after)) {
      preserved.push(path)
      continue
    }
    if (allowed) {
      m5bChanges.push({ path, change: before ? (after ? 'MODIFIED' : 'DELETED') : 'ADDED' })
    } else {
      violations.push({ layer: 'working-tree', path, reason: before ? (after ? 'BASELINE_DRIFT' : 'BASELINE_DELETED') : 'UNEXPECTED_NEW_PATH' })
    }
  }
  return { preserved, m5bChanges, violations }
}

function assertNoDefaultResolverImports(projectRoot, changedPaths) {
  const violations = []
  const defaultResolverSymbol = ['resolve', 'Default', 'Db', 'Path'].join('')
  const defaultConnectionModule = ['src', 'main', 'db', 'connection'].join('/')
  for (const path of changedPaths) {
    if (!path.startsWith('scripts/') || !/m5b/i.test(path) || !/\.(?:mjs|js|ts)$/.test(path)) continue
    const absolutePath = resolve(projectRoot, path)
    let source
    try {
      source = readFileSync(absolutePath, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue
      throw error
    }
    if (source.includes(defaultResolverSymbol) || source.includes(defaultConnectionModule)) {
      violations.push({ layer: 'static-import', path, reason: 'DEFAULT_RUNTIME_RESOLVER_REFERENCE' })
    }
  }
  return violations
}

export class M5bContractScopeError extends Error {
  constructor(message, report = null) {
    super(message.startsWith('[m5b-contract-scope]') ? message : `[m5b-contract-scope] ${message}`)
    this.name = 'M5bContractScopeError'
    this.report = report
  }
}

export function collectM5bContractScope({ projectRoot, step }) {
  const root = resolve(projectRoot)
  const start = JSON.parse(readFileSync(resolve(root, 'scripts/fixtures/m5b-implementation-start-v1.json'), 'utf8'))
  if (start.schema_version !== M5B_START_SCHEMA_VERSION) throw new M5bContractScopeError(`invalid start schema ${start.schema_version}`)
  const allowedPaths = allowedM5bPathsForStep(step)

  const head = runGit(root, ['rev-parse', 'HEAD']).toString('utf8').trim()
  const branch = runGit(root, ['branch', '--show-current']).toString('utf8').trim()
  const currentIndex = parseIndexEntries(runGit(root, ['ls-files', '-s', '-z']))
  const trackedPaths = parseZeroList(runGit(root, ['ls-files', '-z']))
  const untrackedPaths = parseZeroList(runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']))
  const currentEntries = [
    ...trackedPaths.map((path) => currentEntry(root, path, 'TRACKED')),
    ...untrackedPaths.map((path) => currentEntry(root, path, 'UNTRACKED'))
  ].sort((left, right) => left.path.localeCompare(right.path))

  const comparison = compareM5bWorktreeSnapshot({
    baselineEntries: start.entries,
    currentEntries,
    allowedPaths
  })
  const violations = [...comparison.violations]

  if (head !== start.head_commit) violations.push({ layer: 'committed', path: 'HEAD', reason: `${start.head_commit}->${head}` })
  if (branch !== start.branch) violations.push({ layer: 'committed', path: 'BRANCH', reason: `${start.branch}->${branch}` })

  const startIndexKeys = start.index_entries.map(indexEntryKey)
  const currentIndexKeys = currentIndex.map(indexEntryKey)
  if (startIndexKeys.length !== currentIndexKeys.length || startIndexKeys.some((value, index) => value !== currentIndexKeys[index])) {
    const startSet = new Set(startIndexKeys)
    const currentSet = new Set(currentIndexKeys)
    for (const value of startIndexKeys.filter((entry) => !currentSet.has(entry))) violations.push({ layer: 'index', path: value, reason: 'INDEX_BASELINE_MISSING' })
    for (const value of currentIndexKeys.filter((entry) => !startSet.has(entry))) violations.push({ layer: 'index', path: value, reason: 'INDEX_UNEXPECTED' })
  }

  violations.push(...assertNoDefaultResolverImports(root, comparison.m5bChanges.map((entry) => entry.path)))

  return {
    projectRoot: root,
    step,
    head,
    branch,
    startHead: start.head_commit,
    startBranch: start.branch,
    committedStatus: runGit(root, ['diff', '--name-status', `${start.head_commit}..HEAD`, '--']).toString('utf8').trim(),
    indexStatus: runGit(root, ['diff', '--cached', '--name-status', start.head_commit, '--']).toString('utf8').trim(),
    workingStatus: runGit(root, ['status', '--short', '--untracked-files=all']).toString('utf8').trim(),
    preservedCount: comparison.preserved.length,
    m5bChanges: comparison.m5bChanges,
    violations
  }
}

export function verifyM5bContractScope(options) {
  const report = collectM5bContractScope(options)
  if (report.violations.length > 0) {
    const details = report.violations.map((entry) => `${entry.layer}:${entry.path}:${entry.reason}`).join(', ')
    throw new M5bContractScopeError(`scope violations: ${details}`, report)
  }
  return report
}

export function formatM5bScopeReport(report) {
  return [
    `[m5b-contract-scope] committed name-status (${report.committedStatus ? report.committedStatus.split('\n').length : 0})`,
    report.committedStatus || '(none)',
    `[m5b-contract-scope] index name-status (${report.indexStatus ? report.indexStatus.split('\n').length : 0})`,
    report.indexStatus || '(none)',
    `[m5b-contract-scope] working status (${report.workingStatus ? report.workingStatus.split('\n').length : 0})`,
    report.workingStatus || '(none)',
    `[m5b-contract-scope] preserved=${report.preservedCount}, m5b_changes=${report.m5bChanges.length}, violations=${report.violations.length}`
  ].join('\n')
}
