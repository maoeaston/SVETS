import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  EXPECTED_COUNTS,
  inventoryDigest,
  loadInventoryDocuments,
  scanCheckout,
  scanGitTree,
  scanSourceEntries,
  validateBaselineInventory,
  validateMigrationInventory
} from '../lib/m5a-command-boundary-inventory.mjs'

const projectRoot = process.cwd()

function clone(value) {
  return structuredClone(value)
}

function frozenM5ATargetScan(documents) {
  return {
    channels: clone(documents.active.channels),
    direct_callsites: clone(documents.active.direct_callsites),
    capability_callsites: clone(documents.active.capability_callsites),
    direct_files: documents.active.direct_files.map((entry) => entry.path),
    delegating_roots: documents.active.delegating_roots.map((entry) => entry.path),
    test_only_import_violations: []
  }
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

describe('M5A command boundary inventory', () => {
  it('冻结规划基点的 74/28/46、35 direct files、5 roots 和两个 task-closure callsite', () => {
    const documents = loadInventoryDocuments(projectRoot)
    const scan = scanGitTree(projectRoot, documents.legacy.base_commit)
    expect(validateBaselineInventory(scan, documents.legacy)).toEqual(EXPECTED_COUNTS)
    expect(documents.legacy.counts).toMatchObject({
      direct_callsites: 260,
      capability_callsites: 40
    })
    expect(documents.legacy.direct_files.reduce((counts, item) => {
      counts[item.classification] = (counts[item.classification] ?? 0) + 1
      return counts
    }, {})).toEqual({
      PRODUCTION_INTERNAL_DIRECT: 19,
      TEST_ONLY_EXCEPTION: 2,
      LOW_LEVEL_PORT: 1,
      BUS_COMMAND_DIRECT: 13
    })
    expect(documents.legacy.capability_callsites.filter((item) =>
      item.file === 'src/main/domain/task-closure-service.ts' && item.kind === 'REPORT_COMMAND_CALL'
    ).map((item) => item.symbol)).toEqual([
      'TaskClosureService.confirmBaseTaskClosure',
      'TaskClosureService.replaceBaseTaskClosure'
    ])
  })

  it('baseline 从固定 Git tree 读取，不被 checkout 中的移动或改名伪装', () => {
    const root = mkdtempSync(join(tmpdir(), 'svets-m5a-git-tree-'))
    try {
      const handlerDir = join(root, 'src', 'main', 'ipc', 'handlers')
      mkdirSync(handlerDir, { recursive: true })
      const handlerPath = join(handlerDir, 'sample.ts')
      writeFileSync(handlerPath, "ipcMain.handle('sample:before', () => ({ success: true }))\n")
      git(root, ['init', '-q'])
      git(root, ['config', 'user.name', 'M5A Test'])
      git(root, ['config', 'user.email', 'm5a@example.invalid'])
      git(root, ['add', '.'])
      git(root, ['commit', '-qm', 'baseline'])
      const base = git(root, ['rev-parse', 'HEAD'])
      writeFileSync(handlerPath, "ipcMain.handle('sample:after', () => ({ success: true }))\n")

      expect(scanGitTree(root, base).channels.map((item) => item.channel)).toEqual(['sample:before'])
      expect(scanCheckout(root).channels.map((item) => item.channel)).toEqual(['sample:after'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('拒绝漏 channel、重复 channel 和 dynamic channel', () => {
    const documents = loadInventoryDocuments(projectRoot)
    const scan = scanGitTree(projectRoot, documents.legacy.base_commit)

    const missing = clone(scan)
    missing.channels.pop()
    expect(() => validateBaselineInventory(missing, documents.legacy)).toThrow('legacy IPC channel names mismatch')

    const duplicate = clone(scan)
    duplicate.channels.push(clone(duplicate.channels[0]))
    expect(() => validateBaselineInventory(duplicate, documents.legacy)).toThrow(/duplicate/)

    const dynamic = clone(scan)
    dynamic.channels[0].dynamic = true
    dynamic.channels[0].channel = null
    expect(() => validateBaselineInventory(dynamic, documents.legacy)).toThrow('dynamic IPC channel')
  })

  it('拒绝同文件新增 sink、漏 capability 和未登记 coordinator 注入', () => {
    const documents = loadInventoryDocuments(projectRoot)
    const scan = scanGitTree(projectRoot, documents.legacy.base_commit)

    const extraSink = clone(scan)
    extraSink.direct_callsites.push({
      ...clone(extraSink.direct_callsites[0]),
      line: 9999,
      fingerprint: 'a'.repeat(64)
    })
    expect(() => validateBaselineInventory(extraSink, documents.legacy)).toThrow('legacy direct callsites fingerprints mismatch')

    const missingCapability = clone(scan)
    missingCapability.capability_callsites = missingCapability.capability_callsites.filter((item) =>
      item.symbol !== 'TaskClosureService.replaceBaseTaskClosure'
    )
    expect(() => validateBaselineInventory(missingCapability, documents.legacy)).toThrow('legacy capability callsites fingerprints mismatch')

    const injectedCoordinator = clone(scan)
    injectedCoordinator.capability_callsites.push({
      ...clone(injectedCoordinator.capability_callsites[0]),
      file: 'src/main/domain/unregistered-service.ts',
      symbol: 'createUnregisteredService',
      fingerprint: 'b'.repeat(64)
    })
    injectedCoordinator.delegating_roots.push('src/main/domain/unregistered-service.ts')
    expect(() => validateBaselineInventory(injectedCoordinator, documents.legacy)).toThrow('legacy capability callsites fingerprints mismatch')
  })

  it('扫描 alias/capability 并拒绝 production import test-only adapter', () => {
    const scan = scanSourceEntries([
      {
        file: 'src/main/domain/unregistered-service.ts',
        source: "import { ReportCommandCoordinator as Coordinator } from './report-command-coordinator'\nexport function run(coordinator) { const constructed = new Coordinator({}); return coordinator.runSingleEventCommand({ constructed }) }\n"
      },
      {
        file: 'src/main/domain/bad-writer.ts',
        source: "import { createTestDatabase } from '../db/test-helpers'\nimport { writeEvent as emit } from './event-writer'\nimport { writeFileSync as persist } from 'node:fs'\nexport function write(stmt) { const execute = stmt.run; persist('/tmp/noop', 'x'); emit({}); return execute() }\n"
      },
      {
        file: 'src/main/application/services/sample.ts',
        source: "export function mutate(execution) { return execution.eventPort.writeEvent({}) }\n"
      },
      {
        file: 'src/main/ipc/handlers/sample.ts',
        source: "ipcMain.handle(channelName, () => undefined)\n"
      }
    ])
    expect(scan.test_only_import_violations).toEqual([
      expect.objectContaining({
        file: 'src/main/domain/bad-writer.ts',
        imported_test_only_file: 'src/main/db/test-helpers.ts'
      })
    ])
    expect(scan.capability_callsites.map((item) => item.kind).sort()).toEqual([
      'LEGACY_EVENT_PORT_CALL',
      'REPORT_COMMAND_CALL',
      'REPORT_COORDINATOR_IMPORT',
      'REPORT_COORDINATOR_CONSTRUCTION'
    ].sort())
    expect(scan.delegating_roots).toEqual([
      'src/main/application/services/sample.ts',
      'src/main/domain/unregistered-service.ts'
    ])
    expect(scan.direct_callsites.filter((item) => item.file === 'src/main/domain/bad-writer.ts').map((item) => item.kind).sort()).toEqual([
      'DB_RUN_ALIAS',
      'EVENT_WRITE',
      'FILE_WRITEFILESYNC'
    ])
    expect(scan.channels[0]).toMatchObject({ channel: null, dynamic: true })
  })

  it('冻结的 M5A target 精确核对 central registry、active manifest、最终 owner 和零 pending', () => {
    const documents = loadInventoryDocuments(projectRoot)
    const scan = frozenM5ATargetScan(documents)
    expect(inventoryDigest(scan)).toBe(documents.active.source_digest)
    expect(validateMigrationInventory({ scan, ...documents, target: true })).toMatchObject({
      channels: 74,
      reads: 28,
      mutations: 46,
      direct_files: 28,
      delegating_roots: 13,
      pending: 0,
      registered_exceptions: 76,
      step: 'target'
    })
    expect(scan.channels.every((entry) => entry.file === 'src/main/ipc/handler-registry.ts')).toBe(true)
    expect(scan.capability_callsites.filter((entry) => entry.kind === 'IPC_HANDLER_REGISTRATION')).toEqual([
      expect.objectContaining({
        file: 'src/main/ipc/index.ts',
        symbol: 'registerIpcHandlers',
        callee: 'registerCentralIpcHandlers'
      })
    ])
    expect(scan.direct_callsites).toHaveLength(215)
    expect(scan.capability_callsites).toHaveLength(72)
    expect(scan.capability_callsites.filter((entry) => entry.kind === 'LEGACY_EVENT_PORT_CALL'))
      .toHaveLength(43)
    expect(documents.active.stage).toBe('M5A-11')
    expect(documents.active.capability_callsites).toContainEqual(expect.objectContaining({
      id: 'ACTIVE-CAP-018',
      file: 'src/main/application/services/job-skill-report-service.ts',
      kind: 'REPORT_COORDINATOR_IMPORT'
    }))
    expect(documents.mapping.entries.filter((entry) => entry.legacy_id === null)).toHaveLength(4)
    expect(documents.mapping.entries.filter((entry) => entry.status === 'REGISTERED_EXCEPTION'))
      .toHaveLength(76)
    expect(documents.mapping.entries.filter((entry) => entry.status === 'REGISTERED_EXCEPTION')
      .reduce((counts, entry) => {
        counts[entry.exception_kind] = (counts[entry.exception_kind] ?? 0) + 1
        return counts
      }, {})).toEqual({ TEST_ONLY: 29, MIGRATION_INTERNAL: 47 })
    expect(documents.mapping.entries.filter((entry) => entry.status === 'MIGRATION_PENDING'))
      .toHaveLength(0)
    expect(documents.pending.steps['M5A-11']).toEqual([])
  })

  it('M5B checkout 的默认 target 预期失败，M5A baseline CLI 仍通过，并拒绝重新引入 pending、mapping 漏项与非单调 pending fixture', () => {
    const documents = loadInventoryDocuments(projectRoot)
    const scan = frozenM5ATargetScan(documents)

    const targetCli = spawnSync(process.execPath, ['scripts/check-m5a-command-boundary.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(targetCli.status).toBe(1)
    expect(targetCli.stderr).toContain('active IPC channel names mismatch')
    expect(targetCli.stderr).toContain('runtime:getHealth')

    const baselineCli = spawnSync(process.execPath, ['scripts/check-m5a-command-boundary.mjs', '--mode', 'baseline'], {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: false
    })
    expect(baselineCli.status).toBe(0)
    expect(baselineCli.stdout).toContain('baseline PASS')

    const reintroducedPending = clone(documents)
    const exception = reintroducedPending.mapping.entries.find((entry) => entry.status === 'REGISTERED_EXCEPTION')
    exception.status = 'MIGRATION_PENDING'
    exception.migrated_in_step = null
    expect(() => validateMigrationInventory({ scan, ...reintroducedPending, target: true })).toThrow('target has 1 MIGRATION_PENDING entries')

    const missingMapping = clone(documents)
    const legacyIndex = missingMapping.mapping.entries.findIndex((entry) => typeof entry.legacy_id === 'string')
    missingMapping.mapping.entries.splice(legacyIndex, 1)
    expect(() => validateMigrationInventory({ scan, ...missingMapping, target: true })).toThrow('mapping legacy ids mismatch')

    const nonMonotonic = clone(documents)
    nonMonotonic.pending.steps['M5A-11'].push('UNKNOWN-LEGACY-ID')
    expect(() => validateMigrationInventory({ scan, ...nonMonotonic, target: true })).toThrow('pending fixture M5A-11 is not monotonic')
  })

  it('拒绝 active manifest 漂移、非法 mapping/exception metadata 和 test-only production import', () => {
    const documents = loadInventoryDocuments(projectRoot)
    const scan = frozenM5ATargetScan(documents)

    const driftedActive = clone(documents)
    driftedActive.active.direct_callsites[0].fingerprint = 'c'.repeat(64)
    expect(() => validateMigrationInventory({ scan, ...driftedActive, target: true })).toThrow('active direct callsites fingerprints mismatch')

    const invalidMapping = clone(documents)
    invalidMapping.mapping.entries[0].test_evidence = []
    expect(() => validateMigrationInventory({ scan, ...invalidMapping, target: true })).toThrow('requires test_evidence')

    const malformedId = clone(documents)
    malformedId.active.capability_callsites[0].id = 'ACTIVE-CAP-NaN'
    expect(() => validateMigrationInventory({ scan, ...malformedId, target: true })).toThrow('active entries contains malformed id')

    const invalidNewActive = clone(documents)
    const newActive = invalidNewActive.mapping.entries.find((entry) => entry.legacy_id === null)
    delete newActive.origin
    expect(() => validateMigrationInventory({ scan, ...invalidNewActive, target: true })).toThrow('requires M5A_NEW_ACTIVE origin')

    const invalidException = clone(documents)
    const registered = invalidException.mapping.entries.find((entry) => entry.status === 'REGISTERED_EXCEPTION')
    delete registered.actor_policy
    expect(() => validateMigrationInventory({ scan, ...invalidException, target: true })).toThrow('registered exception requires actor_policy')

    const widenedException = clone(documents)
    const widened = widenedException.mapping.entries.find((entry) => entry.status === 'REGISTERED_EXCEPTION')
    widened.exception_kind = 'RUNTIME_BYPASS'
    expect(() => validateMigrationInventory({ scan, ...widenedException, target: true })).toThrow('invalid registered exception scope')

    const importViolation = clone(scan)
    importViolation.test_only_import_violations.push({
      file: 'src/main/domain/bad.ts',
      imported_test_only_file: 'src/main/db/test-helpers.ts',
      line: 1
    })
    expect(() => validateMigrationInventory({ scan: importViolation, ...documents, target: true })).toThrow('production imports test-only adapter')
  })

  it('target fail-closes handler side effects, non-root coordinator construction and missing task-closure owner', () => {
    const documents = loadInventoryDocuments(projectRoot)
    const scan = frozenM5ATargetScan(documents)

    const handlerBypass = clone(scan)
    handlerBypass.direct_callsites.push({
      ...clone(handlerBypass.direct_callsites[0]),
      file: 'src/main/ipc/handlers/bypass.ts',
      symbol: 'bypass',
      fingerprint: 'd'.repeat(64)
    })
    handlerBypass.direct_files.push('src/main/ipc/handlers/bypass.ts')
    const handlerDocuments = clone(documents)
    handlerDocuments.active.direct_callsites.push(clone(handlerBypass.direct_callsites.at(-1)))
    handlerDocuments.active.direct_callsites.at(-1).id = 'ACTIVE-DIRECT-999'
    handlerDocuments.active.direct_files.push({ path: 'src/main/ipc/handlers/bypass.ts', classification: 'BUS_COMMAND_DIRECT' })
    handlerDocuments.mapping.entries.push({
      id: 'MAPPING-999',
      legacy_id: null,
      active_id: 'ACTIVE-DIRECT-999',
      active_owner: 'bypass',
      capability: 'DB_RUN',
      status: 'MIGRATED',
      planned_step: 'M5A-11',
      migrated_in_step: 'M5A-11',
      origin: 'M5A_NEW_ACTIVE',
      test_evidence: ['scripts/__tests__/m5a-command-boundary-inventory.test.mjs']
    })
    expect(() => validateMigrationInventory({ scan: handlerBypass, ...handlerDocuments, target: true }))
      .toThrow('target handler side effects remain')

    const extraCoordinator = clone(scan)
    const construction = clone(extraCoordinator.capability_callsites.find((entry) => entry.kind === 'REPORT_COORDINATOR_CONSTRUCTION'))
    construction.file = 'src/main/domain/extra-coordinator.ts'
    construction.symbol = 'createExtraCoordinator'
    construction.fingerprint = 'e'.repeat(64)
    extraCoordinator.capability_callsites.push(construction)
    extraCoordinator.delegating_roots.push(construction.file)
    const coordinatorDocuments = clone(documents)
    coordinatorDocuments.active.capability_callsites.push({ ...construction, id: 'ACTIVE-CAP-999' })
    coordinatorDocuments.active.delegating_roots.push({ path: construction.file, classification: 'PRODUCTION_INTERNAL_DELEGATION' })
    coordinatorDocuments.mapping.entries.push({
      id: 'MAPPING-998',
      legacy_id: null,
      active_id: 'ACTIVE-CAP-999',
      active_owner: 'createExtraCoordinator',
      capability: 'REPORT_COORDINATOR_CONSTRUCTION',
      status: 'MIGRATED',
      planned_step: 'M5A-11',
      migrated_in_step: 'M5A-11',
      origin: 'M5A_NEW_ACTIVE',
      test_evidence: ['scripts/__tests__/m5a-command-boundary-inventory.test.mjs']
    })
    expect(() => validateMigrationInventory({ scan: extraCoordinator, ...coordinatorDocuments, target: true }))
      .toThrow('target report coordinator construction must have one composition-root owner')

    const missingTaskClosure = clone(scan)
    const targetCall = missingTaskClosure.capability_callsites.find((entry) => entry.symbol === 'TaskClosureService.replaceBaseTaskClosure')
    missingTaskClosure.capability_callsites.splice(missingTaskClosure.capability_callsites.indexOf(targetCall), 1)
    const taskDocuments = clone(documents)
    taskDocuments.active.capability_callsites = taskDocuments.active.capability_callsites.filter((entry) => entry.fingerprint !== targetCall.fingerprint)
    const removedActive = documents.active.capability_callsites.find((entry) => entry.fingerprint === targetCall.fingerprint)
    const remainingTaskClosure = taskDocuments.active.capability_callsites.find((entry) => entry.symbol === 'TaskClosureService.confirmBaseTaskClosure')
    const remapped = taskDocuments.mapping.entries.find((entry) => entry.active_id === removedActive.id)
    remapped.active_id = remainingTaskClosure.id
    remapped.active_owner = remainingTaskClosure.symbol
    expect(() => validateMigrationInventory({ scan: missingTaskClosure, ...taskDocuments, target: true }))
      .toThrow('target task closure coordinator owners mismatch')
  })
})
