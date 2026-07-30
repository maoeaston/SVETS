import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { M5B_START_SCHEMA_VERSION } from './m5b-runtime-inventory.mjs'

const STEP_ORDER = Object.freeze(Array.from({ length: 15 }, (_, index) => `M5B-${index + 1}`))
const CHECKPOINT_SCHEMA_VERSION = 'm5b-accepted-checkpoint-v1'
const CHECKPOINT_PATH = 'scripts/fixtures/m5b-accepted-checkpoint-v1.json'

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

const STEP10_ALLOWED = Object.freeze([
  ...STEP9_ALLOWED,
  'doc/features/event-batch-v2.2-runtime-m5b10-r3-review.md',
  'scripts/fixtures/m5b-step10-source-delta-v1.json',
  'scripts/fixtures/m5b-accepted-checkpoint-v1.json',
  'scripts/update-m5b-step10-fixture.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/__tests__/m5b-contract-scope.test.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/main/db/memory-adapter.ts',
  'src/main/application/planners/scoring-planner.ts',
  'src/main/application/planners/__tests__/scoring-planner.test.ts',
  'src/main/application/planners/__tests__/scoring-test-support.ts',
  'src/main/domain/projectors/scoring-projector.ts',
  'src/main/domain/projectors/__tests__/scoring-projector.test.ts',
  'src/main/application/services/__tests__/scoring-command-bus.test.ts',
  'src/main/application/services/__tests__/multi-event-command-failure.test.ts',
  'src/main/application/services/__tests__/scoring-test-support.ts'
])

const STEP11_ALLOWED = Object.freeze([
  ...STEP10_ALLOWED,
  'doc/features/event-batch-v2.2-runtime-m5b11-r3-review.md',
  'scripts/fixtures/m5b-step11-source-delta-v1.json',
  'scripts/update-m5b-step11-fixture.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/__tests__/m5b-contract-scope.test.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/shared/types/event-payloads.ts',
  'src/main/domain/local-runtime-context.ts',
  'src/main/domain/__tests__/local-runtime-context.test.ts',
  'src/main/application/planners/assignment-planner.ts',
  'src/main/application/planners/__tests__/assignment-planner.test.ts',
  'src/main/application/planners/__tests__/assignment-test-support.ts',
  'src/main/domain/projectors/assignment-projector.ts',
  'src/main/domain/projectors/__tests__/assignment-projector.test.ts'
])

const STEP13_ALLOWED = Object.freeze([
  ...STEP11_ALLOWED,
  'doc/features/event-batch-v2.2-runtime-m5b13-r3-review.md',
  'scripts/fixtures/m5b-step13-source-delta-v1.json',
  'scripts/update-m5b-step13-fixture.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/__tests__/m5b-contract-scope.test.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/shared/types/event-payloads.ts',
  'src/main/domain/event-batch/command-plan.ts',
  'src/main/domain/event-batch/result-registry.ts',
  'src/main/domain/event-batch/batch-coordinator.ts',
  'src/main/domain/event-batch/startup-recovery.ts',
  'src/main/domain/event-batch/artifact-probe.ts',
  'src/main/domain/event-batch/artifact-publisher.ts',
  'src/main/domain/event-batch/artifact-recovery.ts',
  'src/main/domain/event-batch/__tests__/artifact-probe.test.ts',
  'src/main/domain/event-batch/__tests__/artifact-publisher.test.ts',
  'src/main/domain/event-batch/__tests__/artifact-recovery.test.ts',
  'src/main/application/planners/report-export-planner.ts',
  'src/main/application/planners/__tests__/report-export-planner.test.ts',
  'src/main/application/planners/__tests__/report-export-test-support.ts',
  'src/main/domain/projectors/report-export-projector.ts',
  'src/main/domain/projectors/__tests__/report-export-projector.test.ts'
])

// M5B-12 is deliberately applied after the already accepted test-only M5B-13
// artifact slice. Its allowlist inherits that exact boundary and opens only
// the prepared safety lifecycle surface.
const STEP12_ALLOWED = Object.freeze([
  ...STEP13_ALLOWED,
  'doc/features/event-batch-v2.2-runtime-m5b12-r3-review.md',
  'scripts/fixtures/m5b-step12-source-delta-v1.json',
  'scripts/update-m5b-step12-fixture.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/lib/m5b-isolated-db.mjs',
  'scripts/verify-m5b-isolated-db.mjs',
  'scripts/__tests__/m5b-contract-scope.test.mjs',
  'scripts/__tests__/m5b-isolated-db.test.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/shared/types/event-payloads.ts',
  'src/main/application/planners/safety-planner.ts',
  'src/main/application/planners/__tests__/safety-planner.test.ts',
  'src/main/application/planners/__tests__/safety-test-support.ts',
  'src/main/domain/projectors/safety-projector.ts',
  'src/main/domain/projectors/__tests__/safety-projector.test.ts'
])

// M5B-14 is the single production-composition cutover.  It opens the runtime,
// startup, IPC and renderer health boundary, while retaining the reviewed
// prepared-domain files inherited from the earlier test-only steps.
const STEP14_ALLOWED = Object.freeze([
  ...STEP12_ALLOWED,
  '.continue-here.md',
  'doc/会话启动.md',
  'doc/features/event-batch-v2.2-runtime-validation.md',
  'doc/features/event-batch-v2.2-runtime-m5b14-r3-review.md',
  'scripts/fixtures/m5b-step14-source-delta-v1.json',
  'scripts/update-m5b-step14-fixture.mjs',
  'scripts/lib/m5b-contract-scope.mjs',
  'scripts/lib/m5b-runtime-inventory.mjs',
  'scripts/lib/m5b-isolated-db.mjs',
  'scripts/verify-m5b-isolated-db.mjs',
  'scripts/__tests__/m5b-contract-scope.test.mjs',
  'scripts/__tests__/m5b-isolated-db.test.mjs',
  'scripts/__tests__/m5b-runtime-inventory.test.mjs',
  'src/main/index.ts',
  'src/main/db/connection.ts',
  'src/main/db/migration-startup.ts',
  'src/main/db/schema.sql',
  'src/main/db/migrations.ts',
  'src/main/db/sqlite-adapter.ts',
  'src/main/db/__tests__/connection-event-batch.test.ts',
  'src/main/db/__tests__/migration-startup.test.ts',
  'src/main/application/runtime/application-runtime.ts',
  'src/main/application/runtime/error-code-bootstrap.ts',
  'src/main/application/services/__tests__/account-command-bus.test.ts',
  'src/main/application/services/__tests__/assessment-command-bus.test.ts',
  'src/main/application/services/__tests__/assignment-safety-command-bus.test.ts',
  'src/main/application/services/__tests__/scoring-command-bus.test.ts',
  'src/main/application/services/__tests__/training-command-bus.test.ts',
  'src/main/application/runtime/m5b-domain-executor.ts',
  'src/main/application/runtime/__tests__/application-runtime.test.ts',
  'src/main/application/command/gate-only-executor.ts',
  'src/main/application/command/gate-only-command-apply.ts',
  'src/main/application/command/m5a-command-definitions.ts',
  'src/main/application/planners/assignment-planner.ts',
  'src/main/application/planners/scoring-planner.ts',
  'src/main/application/planners/report-export-planner.ts',
  'src/main/domain/event-batch/runtime-corruption.ts',
  'src/main/ipc/handler-registry.ts',
  'src/main/ipc/handlers/reports.ts',
  'src/main/ipc/handlers/safety.ts',
  'src/main/ipc/__tests__/handler-registry.test.ts',
  'src/preload/index.ts',
  'src/shared/types/command-transport.ts',
  'src/shared/types/ipc-api.ts',
  'src/renderer/src/stores/runtime-health.ts',
  'src/renderer/src/stores/__tests__/runtime-health.test.ts',
  'src/renderer/src/components/runtime-health-banner.vue',
  'src/renderer/src/components/__tests__/runtime-health-banner.test.ts',
  'src/renderer/src/App.vue'
])

const STEP15_ALLOWED = Object.freeze([
  ...STEP14_ALLOWED,
  'doc/features/event-batch-v2.2-runtime-m5b15-r3-review.md',
  'doc/specs/baseline.yaml',
  'doc/specs/project-invariants.md',
  'doc/index.md',
  'package.json',
  'scripts/e2e/m5b-ui-smoke.mjs',
  'scripts/e2e/m5b-native-electron.ts',
  'scripts/verify-m5b-native-electron.mjs'
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

function parseNameStatus(buffer) {
  const fields = parseZeroList(buffer)
  const entries = []
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    if (!status) throw new M5bContractScopeError('empty git name-status entry')
    const kind = status[0]
    if (kind === 'R' || kind === 'C') {
      const previousPath = fields[index++]
      const path = fields[index++]
      if (!previousPath || !path) throw new M5bContractScopeError(`incomplete git ${kind} entry`)
      entries.push({ status, path: previousPath })
      entries.push({ status, path })
      continue
    }
    const path = fields[index++]
    if (!path) throw new M5bContractScopeError(`incomplete git ${kind} entry`)
    entries.push({ status, path })
  }
  return entries
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

function readAcceptedCheckpoint(projectRoot, start) {
  const checkpointPath = resolve(projectRoot, CHECKPOINT_PATH)
  if (!existsSync(checkpointPath)) return null
  const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'))
  if (checkpoint.schema_version !== CHECKPOINT_SCHEMA_VERSION) {
    throw new M5bContractScopeError(`invalid accepted checkpoint schema ${checkpoint.schema_version}`)
  }
  if (checkpoint.source_start_commit !== start.head_commit || checkpoint.checkpoint_parent !== start.head_commit) {
    throw new M5bContractScopeError('accepted checkpoint is not bound to the frozen implementation start')
  }
  for (const field of ['checkpoint_commit', 'checkpoint_tree', 'source_to_checkpoint_name_status_sha256']) {
    if (typeof checkpoint[field] !== 'string' || !checkpoint[field].trim()) {
      throw new M5bContractScopeError(`accepted checkpoint ${field} is required`)
    }
  }
  if (!Number.isSafeInteger(checkpoint.source_to_checkpoint_path_count) || checkpoint.source_to_checkpoint_path_count < 0) {
    throw new M5bContractScopeError('accepted checkpoint source_to_checkpoint_path_count is invalid')
  }

  const tree = runGit(projectRoot, ['rev-parse', `${checkpoint.checkpoint_commit}^{tree}`]).toString('utf8').trim()
  if (tree !== checkpoint.checkpoint_tree) throw new M5bContractScopeError('accepted checkpoint tree drifted')
  const delta = runGit(projectRoot, ['diff', '--name-status', '-z', `${start.head_commit}..${checkpoint.checkpoint_commit}`, '--'])
  if (sha256(delta) !== checkpoint.source_to_checkpoint_name_status_sha256) {
    throw new M5bContractScopeError('accepted checkpoint name-status digest drifted')
  }
  if (parseNameStatus(delta).length !== checkpoint.source_to_checkpoint_path_count) {
    throw new M5bContractScopeError('accepted checkpoint name-status count drifted')
  }
  return checkpoint
}

function compareM5bCheckpointWorktree({ projectRoot, checkpointCommit, trackedPaths, untrackedPaths, allowedPaths }) {
  const changed = parseNameStatus(runGit(projectRoot, ['diff', '--name-status', '-z', checkpointCommit, '--']))
  const changedPaths = new Set(changed.map((entry) => entry.path))
  const m5bChanges = []
  const violations = []
  const addChange = (path, change) => {
    if (NEVER_ALLOWED.includes(path)) {
      violations.push({ layer: 'working-tree', path, reason: 'NEVER_ALLOWED' })
    } else if (allowedPaths.has(path)) {
      m5bChanges.push({ path, change })
    } else {
      violations.push({ layer: 'working-tree', path, reason: change === 'DELETED' ? 'BASELINE_DELETED' : change === 'ADDED' ? 'UNEXPECTED_NEW_PATH' : 'BASELINE_DRIFT' })
    }
  }
  for (const entry of changed) {
    const kind = entry.status[0]
    addChange(entry.path, kind === 'A' ? 'ADDED' : kind === 'D' ? 'DELETED' : 'MODIFIED')
  }
  for (const path of untrackedPaths) {
    if (!changedPaths.has(path)) addChange(path, 'ADDED')
  }
  return {
    preserved: trackedPaths.filter((path) => !changedPaths.has(path)),
    m5bChanges,
    violations
  }
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
  if (step === 'M5B-10') return new Set(STEP10_ALLOWED)
  if (step === 'M5B-11') return new Set(STEP11_ALLOWED)
  if (step === 'M5B-12') return new Set(STEP12_ALLOWED)
  if (step === 'M5B-13') return new Set(STEP13_ALLOWED)
  if (step === 'M5B-14') return new Set(STEP14_ALLOWED)
  if (step === 'M5B-15') return new Set(STEP15_ALLOWED)
  if (!['M5B-1', 'M5B-2', 'M5B-3', 'M5B-4', 'M5B-5', 'M5B-6', 'M5B-7', 'M5B-8', 'M5B-9', 'M5B-10', 'M5B-11', 'M5B-12', 'M5B-13', 'M5B-14', 'M5B-15'].includes(step)) {
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
    if (path === 'scripts/lib/m5b-contract-scope.mjs') continue
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
  const checkpoint = readAcceptedCheckpoint(root, start)
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

  const comparison = checkpoint
    ? compareM5bCheckpointWorktree({
      projectRoot: root,
      checkpointCommit: checkpoint.checkpoint_commit,
      trackedPaths,
      untrackedPaths,
      allowedPaths
    })
    : compareM5bWorktreeSnapshot({
      baselineEntries: start.entries,
      currentEntries,
      allowedPaths
    })
  const violations = [...comparison.violations]

  const baselineHead = checkpoint?.checkpoint_commit ?? start.head_commit
  if (head !== baselineHead) violations.push({ layer: 'committed', path: 'HEAD', reason: `${baselineHead}->${head}` })
  if (branch !== start.branch) violations.push({ layer: 'committed', path: 'BRANCH', reason: `${start.branch}->${branch}` })

  if (checkpoint) {
    const checkpointIndexStatus = runGit(root, ['diff', '--cached', '--name-status', checkpoint.checkpoint_commit, '--']).toString('utf8').trim()
    if (checkpointIndexStatus) {
      for (const entry of checkpointIndexStatus.split('\n')) violations.push({ layer: 'index', path: entry, reason: 'INDEX_UNEXPECTED' })
    }
  } else {
    const startIndexKeys = start.index_entries.map(indexEntryKey)
    const currentIndexKeys = currentIndex.map(indexEntryKey)
    if (startIndexKeys.length !== currentIndexKeys.length || startIndexKeys.some((value, index) => value !== currentIndexKeys[index])) {
      const startSet = new Set(startIndexKeys)
      const currentSet = new Set(currentIndexKeys)
      for (const value of startIndexKeys.filter((entry) => !currentSet.has(entry))) violations.push({ layer: 'index', path: value, reason: 'INDEX_BASELINE_MISSING' })
      for (const value of currentIndexKeys.filter((entry) => !startSet.has(entry))) violations.push({ layer: 'index', path: value, reason: 'INDEX_UNEXPECTED' })
    }
  }

  violations.push(...assertNoDefaultResolverImports(root, comparison.m5bChanges.map((entry) => entry.path)))

  return {
    projectRoot: root,
    step,
    head,
    branch,
    startHead: baselineHead,
    startBranch: start.branch,
    checkpointHead: checkpoint?.checkpoint_commit ?? null,
    committedStatus: runGit(root, ['diff', '--name-status', `${baselineHead}..HEAD`, '--']).toString('utf8').trim(),
    indexStatus: runGit(root, ['diff', '--cached', '--name-status', baselineHead, '--']).toString('utf8').trim(),
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
