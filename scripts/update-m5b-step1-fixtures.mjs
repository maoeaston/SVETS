#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = resolve(projectRoot, 'scripts/fixtures')
const M5A_DIGEST = 'f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527'
const BASE_COMMIT = '40541c82ef374f28ce300365e0e5cc82423dd99a'

const STEP_ORDER = Object.freeze([
  'M5B-1',
  'M5B-2',
  'M5B-3',
  'M5B-4',
  'M5B-5',
  'M5B-6',
  'M5B-7',
  'M5B-8',
  'M5B-9',
  'M5B-10',
  'M5B-11',
  'M5B-12',
  'M5B-13',
  'M5B-14',
  'M5B-15'
])

const GATE_ONLY = new Set([
  'auth:login',
  'auth:logout',
  'auth:createTeacherAccount',
  'auth:setTeacherAccountStatus',
  'student:create',
  'student:update',
  'student:archive',
  'strategy:createVersion',
  'strategy:update',
  'strategy:setActive'
])

const COMMAND_STEP = Object.freeze({
  'reports:confirmTaskClosure': 'M5B-6',
  'reports:replaceTaskClosure': 'M5B-6',
  'reports:generate': 'M5B-6',
  'reports:confirmPlacementReview': 'M5B-6',
  'reports:lock': 'M5B-6',
  'auth:login': 'M5B-7',
  'auth:logout': 'M5B-7',
  'auth:createTeacherAccount': 'M5B-7',
  'auth:setTeacherAccountStatus': 'M5B-7',
  'student:create': 'M5B-7',
  'student:update': 'M5B-7',
  'student:archive': 'M5B-7',
  'strategy:createVersion': 'M5B-7',
  'strategy:update': 'M5B-7',
  'strategy:setActive': 'M5B-7',
  'training:createSession': 'M5B-8',
  'training:startStep': 'M5B-8',
  'training:completeStep': 'M5B-8',
  'training:skipStep': 'M5B-8',
  'training:failStep': 'M5B-8',
  'training:retryStep': 'M5B-8',
  'assessment:createSession': 'M5B-9',
  'assessment:submitAnswer': 'M5B-9',
  'assessment:emotionInterrupt': 'M5B-9',
  'assessment:emotionResume': 'M5B-9',
  'assessment:pauseSitting': 'M5B-9',
  'assessment:startNextSitting': 'M5B-9',
  'assessment:recordEmotionCollapse': 'M5B-9',
  'assessment:abortSession': 'M5B-9',
  'assessment:calculateResult': 'M5B-9',
  'assessment:startSession': 'M5B-9',
  'assessment:submitOfflineAbilityScores': 'M5B-10',
  'assessment:submitOperationScores': 'M5B-10',
  'assessment:submitJobSkillOfflineScores': 'M5B-10',
  'assessment:recordTeacherObservation': 'M5B-10',
  'assignment:create': 'M5B-11',
  'assignment:confirmStudent': 'M5B-11',
  'assignment:startAssessment': 'M5B-11',
  'assignment:rebind': 'M5B-11',
  'assignment:release': 'M5B-11',
  'safety:confirm': 'M5B-12',
  'safety:resolve': 'M5B-12',
  'safety:void': 'M5B-12',
  'safety:replaceForFactualCorrection': 'M5B-12',
  'assessment:triggerRedline': 'M5B-12',
  'reports:export': 'M5B-13'
})

const STEP1_IMPLEMENTATION_PATHS = Object.freeze([
  'package.json',
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

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'buffer',
    shell: false,
    maxBuffer: 64 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`)
  }
  return result.stdout
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseZeroList(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

function trackedIndexEntries() {
  return parseZeroList(runGit(['ls-files', '-s', '-z'])).map((entry) => {
    const match = /^(\d+) ([0-9a-f]+) (\d)\t(.+)$/.exec(entry)
    if (!match) throw new Error(`unexpected git index entry: ${entry}`)
    return { path: match[4], mode: match[1], blob: match[2], stage: Number(match[3]) }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

function snapshotEntry(path, sourceKind) {
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
    return {
      path,
      source_kind: sourceKind,
      file_type: 'SYMLINK',
      size: Buffer.byteLength(target),
      sha256: sha256(Buffer.from(target, 'utf8'))
    }
  }
  if (!stat.isFile()) throw new Error(`implementation-start path is not a file: ${path}`)
  const bytes = readFileSync(absolutePath)
  return { path, source_kind: sourceKind, file_type: 'FILE', size: bytes.length, sha256: sha256(bytes) }
}

function buildImplementationStart() {
  const index = trackedIndexEntries()
  const trackedPaths = index.map((entry) => entry.path)
  const untrackedPaths = parseZeroList(runGit(['ls-files', '--others', '--exclude-standard', '-z']))
  const excluded = new Set(STEP1_IMPLEMENTATION_PATHS)
  const entries = [
    ...trackedPaths.map((path) => snapshotEntry(path, 'TRACKED')),
    ...untrackedPaths.filter((path) => !excluded.has(path)).map((path) => snapshotEntry(path, 'UNTRACKED'))
  ].sort((left, right) => left.path.localeCompare(right.path))

  const statusBytes = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  return {
    schema_version: 'm5b-implementation-start-v1',
    base_commit: BASE_COMMIT,
    head_commit: runGit(['rev-parse', 'HEAD']).toString('utf8').trim(),
    branch: runGit(['branch', '--show-current']).toString('utf8').trim(),
    m5a_active_inventory_digest: M5A_DIGEST,
    status_porcelain_sha256: sha256(statusBytes),
    excluded_step1_paths: [...STEP1_IMPLEMENTATION_PATHS],
    index_entries: index,
    entries
  }
}

function commandFamily(channel) {
  if (channel.startsWith('auth:')) return 'auth'
  if (channel.startsWith('student:')) return 'student'
  if (channel.startsWith('strategy:')) return 'strategy'
  if (channel.startsWith('training:')) return 'training'
  if (channel.startsWith('assignment:')) return 'assignment'
  if (channel.startsWith('safety:')) return 'safety'
  if (channel.startsWith('reports:')) return 'reports'
  if (channel.startsWith('assessment:')) return 'assessment'
  throw new Error(`unknown command family: ${channel}`)
}

function testId(channel) {
  return `M5B-DIFF-${channel.replaceAll(':', '-').replaceAll(/[^A-Za-z0-9-]/g, '-').toUpperCase()}`
}

function allowedDifferences(channel) {
  if (channel === 'assessment:triggerRedline') {
    return [{
      id: 'REDLINE_EVENT_COMPACTION',
      legacy: ['SAFETY_INCIDENT_CREATED', 'REDLINE_TRIGGERED'],
      target: ['SAFETY_INCIDENT_CREATED'],
      required_equal: ['public_result', 'business_projection', 'safety_result', 'three_key_halt_scope']
    }]
  }
  if (channel === 'reports:export') {
    return [{
      id: 'ARTIFACT_DURABILITY_PROTOCOL',
      target_additions: ['PRE_PONR_PROBE', 'OWNED_STAGE', 'ATOMIC_NO_CLOBBER', 'ARTIFACT_FROM_EVENT'],
      required_equal: ['public_result', 'report_projection', 'successful_html_bytes', 'successful_html_sha256']
    }]
  }
  return []
}

function activeTargetClass(item, exceptionByActiveId) {
  const exception = exceptionByActiveId.get(item.id)
  if (exception?.exception_kind === 'TEST_ONLY') return 'TEST_ONLY'
  if (exception?.exception_kind === 'MIGRATION_INTERNAL') return 'PRE_GATE_MIGRATION_INTERNAL'
  if (item.channel) return item.mode === 'READ' ? 'READ' : (GATE_ONLY.has(item.channel) ? 'GATE_ONLY_MUTATION' : 'BATCH_DOMAIN_MUTATION')

  const file = item.file
  const marker = `${file}\n${item.symbol}\n${item.kind}\n${item.callee}`
  if (/\/__tests__\/|test-helpers|memory-adapter/.test(file)) return 'TEST_ONLY'
  if (/migration|migration-backup|migration-startup|src\/main\/db\/connection|internal-mutation-capability/.test(file)) {
    return 'PRE_GATE_MIGRATION_INTERNAL'
  }
  if (/recovery|legacy-upgrade-recovery/.test(marker)) return 'RECOVERY_INTERNAL'
  if (/auth-service|student-service|strategy-service|auth-session/.test(file)) return 'GATE_ONLY_MUTATION'
  return 'BATCH_DOMAIN_MUTATION'
}

function activePlannedStep(item, targetClass) {
  if (targetClass === 'TEST_ONLY') return 'M5B-1'
  if (targetClass === 'PRE_GATE_MIGRATION_INTERNAL') return item.file.includes('event-batch-migration') ? 'M5B-2' : 'M5B-14'
  if (targetClass === 'RECOVERY_INTERNAL') return 'M5B-5'
  return 'M5B-14'
}

function expectedPending(commands, legacyEventPortIds, reportCommandCallIds) {
  const result = {}
  for (const step of STEP_ORDER) {
    const stepIndex = STEP_ORDER.indexOf(step)
    const cutoverIndex = STEP_ORDER.indexOf('M5B-14')
    result[step] = {
      command_channels: commands
        .filter((command) => STEP_ORDER.indexOf(command.planned_step) > stepIndex)
        .map((command) => command.channel)
        .sort(),
      runtime_health_channel: stepIndex < cutoverIndex,
      legacy_event_port_ids: stepIndex < cutoverIndex ? [...legacyEventPortIds] : [],
      request_report_command_ids: stepIndex < cutoverIndex ? [...reportCommandCallIds] : []
    }
  }
  return result
}

function buildRuntimeInventory() {
  const active = JSON.parse(readFileSync(resolve(fixtureRoot, 'm5a-command-boundary-active-v1.json'), 'utf8'))
  const mapping = JSON.parse(readFileSync(resolve(fixtureRoot, 'm5a-command-boundary-mapping-v1.json'), 'utf8'))
  if (active.source_digest !== M5A_DIGEST) throw new Error('M5A active digest drifted before M5B inventory capture')

  const exceptionEntries = mapping.entries.filter((entry) => entry.status === 'REGISTERED_EXCEPTION')
  const exceptionByActiveId = new Map(exceptionEntries.map((entry) => [entry.active_id, entry]))
  const mutationChannels = active.channels.filter((entry) => entry.mode === 'MUTATION').map((entry) => entry.channel).sort()
  const readChannels = active.channels.filter((entry) => entry.mode === 'READ').map((entry) => entry.channel).sort()
  const commands = mutationChannels.map((channel) => ({
    channel,
    family: commandFamily(channel),
    execution_class: GATE_ONLY.has(channel) ? 'GATE_ONLY_MUTATION' : 'BATCH_DOMAIN_MUTATION',
    planned_step: COMMAND_STEP[channel],
    differential_test_id: testId(channel),
    allowed_behavior_differences: allowedDifferences(channel)
  }))
  for (const command of commands) {
    if (!command.planned_step) throw new Error(`missing M5B planned step for ${command.channel}`)
  }

  const grouped = [
    ['CHANNEL', active.channels],
    ['DIRECT_CALLSITE', active.direct_callsites],
    ['CAPABILITY_CALLSITE', active.capability_callsites]
  ]
  const activeEntries = grouped.flatMap(([sourceKind, items]) => items.map((item) => {
    const targetClass = activeTargetClass(item, exceptionByActiveId)
    return {
      active_id: item.id,
      source_kind: sourceKind,
      source_file: item.file,
      source_symbol: item.symbol,
      source_capability_kind: item.kind ?? null,
      channel: item.channel ?? null,
      target_class: targetClass,
      classification_status: 'CLASSIFIED',
      implementation_status: targetClass === 'TEST_ONLY' ? 'TARGET_RETAINED' : 'MIGRATION_PENDING',
      planned_step: item.channel ? (item.mode === 'READ' ? (item.channel === 'runtime:getHealth' ? 'M5B-14' : 'M5B-14') : COMMAND_STEP[item.channel]) : activePlannedStep(item, targetClass)
    }
  })).sort((left, right) => left.active_id.localeCompare(right.active_id))
  const activeById = new Map(activeEntries.map((entry) => [entry.active_id, entry]))

  const mappingEntries = mapping.entries.map((entry) => {
    const activeEntry = activeById.get(entry.active_id)
    if (!activeEntry) throw new Error(`mapping ${entry.id} references missing active id ${entry.active_id}`)
    return {
      mapping_id: entry.id,
      legacy_id: entry.legacy_id,
      active_id: entry.active_id,
      m5a_status: entry.status,
      m5a_exception_kind: entry.exception_kind ?? null,
      target_class: activeEntry.target_class,
      classification_status: 'CLASSIFIED',
      implementation_status: activeEntry.implementation_status,
      planned_step: activeEntry.planned_step
    }
  }).sort((left, right) => left.mapping_id.localeCompare(right.mapping_id))

  const exceptions = exceptionEntries.map((entry) => ({
    mapping_id: entry.id,
    active_id: entry.active_id,
    source_exception_kind: entry.exception_kind,
    target_class: entry.exception_kind === 'TEST_ONLY' ? 'TEST_ONLY' : 'PRE_GATE_MIGRATION_INTERNAL',
    planned_step: entry.exception_kind === 'TEST_ONLY' ? 'M5B-1' : 'M5B-14',
    rationale: entry.exception_kind === 'TEST_ONLY'
      ? 'Test adapter or fixture remains outside the production import graph.'
      : 'Historical schema/backup write executes before runtime construction under SYSTEM migration capability.'
  })).sort((left, right) => left.mapping_id.localeCompare(right.mapping_id))

  const legacyEventPortIds = active.capability_callsites
    .filter((entry) => entry.kind === 'LEGACY_EVENT_PORT_CALL')
    .map((entry) => entry.id)
    .sort()
  const reportCommandCallIds = active.capability_callsites
    .filter((entry) => entry.kind === 'REPORT_COMMAND_CALL')
    .map((entry) => entry.id)
    .sort()

  return {
    schema_version: 'm5b-command-runtime-inventory-v1',
    inventory_version: 'm5b-step1-v1',
    source: {
      m5a_active_inventory_digest: M5A_DIGEST,
      m5a_channels: active.channels.length,
      m5a_reads: readChannels.length,
      m5a_mutations: mutationChannels.length,
      m5a_active_entries: active.channels.length + active.direct_callsites.length + active.capability_callsites.length,
      m5a_mapping_entries: mapping.entries.length,
      m5a_registered_exceptions: exceptionEntries.length
    },
    target: {
      invoke_channels: 75,
      reads: 29,
      mutations: 46,
      batch_domain_mutations: 36,
      gate_only_mutations: 10,
      new_read_channels: ['runtime:getHealth'],
      existing_read_channels: readChannels,
      legacy_event_port_target: 0,
      request_report_command_target: 0
    },
    step_order: [...STEP_ORDER],
    commands,
    active_entries: activeEntries,
    mapping_entries: mappingEntries,
    exceptions,
    expected_pending: expectedPending(commands, legacyEventPortIds, reportCommandCallIds)
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}

const implementationStartPath = resolve(fixtureRoot, 'm5b-implementation-start-v1.json')
const runtimeInventoryPath = resolve(fixtureRoot, 'm5b-command-runtime-inventory-v1.json')
if (existsSync(implementationStartPath) || existsSync(runtimeInventoryPath)) {
  throw new Error('[m5b-step1-fixtures] fixtures are frozen; refusing to absorb later worktree changes')
}

writeJson(implementationStartPath, buildImplementationStart())
writeJson(runtimeInventoryPath, buildRuntimeInventory())
console.log('[m5b-step1-fixtures] wrote implementation-start and command-runtime inventory fixtures')
