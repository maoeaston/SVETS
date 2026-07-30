import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import initSqlJs from 'sql.js'

import {
  applyEventBatchMigration,
  assertExactEventBatchStructure,
  EVENT_BATCH_MIGRATION_ID,
  EVENT_BATCH_SCHEMA_VERSION,
  inspectEventBatchStructure
} from '../../src/main/db/event-batch-migration.ts'
import {
  DurableFileCapability,
  probeRequiredFileCapabilities
} from '../../src/main/domain/event-batch/file-capability.ts'
import {
  archiveAndTruncateLegacyTail,
  inspectLegacyLogBytes
} from '../../src/main/domain/event-batch/legacy-reader.ts'
import { createLegacyAnchor } from '../../src/main/domain/event-batch/legacy-anchor.ts'
import {
  loadSegmentSources,
  readSegmentIndexFile,
  rebuildSegmentIndexFromDisk,
  reconcileSegmentIndex,
  segmentIndexSha256,
  writeSegmentIndexAtomic
} from '../../src/main/domain/event-batch/segment-index.ts'
import { SegmentStore } from '../../src/main/domain/event-batch/segment-store.ts'
import { probeArtifactTarget } from '../../src/main/domain/event-batch/artifact-probe.ts'
import { publishPreparedArtifact } from '../../src/main/domain/event-batch/artifact-publisher.ts'
import { recoverPreparedArtifact } from '../../src/main/domain/event-batch/artifact-recovery.ts'
import { createCommandRequestHash } from '../../src/main/application/command/command-request-hash.ts'
import { createCommandResultJson, parseCommandResultJson } from '../../src/main/application/command/command-result.ts'
import { CommandRegistry } from '../../src/main/application/command/command-registry.ts'
import { DurableCommandCoordinator } from '../../src/main/application/command/durable-command-coordinator.ts'
import { DurableCommandStore } from '../../src/main/application/command/durable-command-store.ts'
import { GateOnlyExecutor } from '../../src/main/application/command/gate-only-executor.ts'
import { buildCommandEnvelopeV2 } from '../../src/main/application/command/command-envelope.ts'
import { createPreflightErrorMap } from '../../src/main/application/command/public-error-contract.ts'
import {
  EventBatchCoordinator
} from '../../src/main/domain/event-batch/batch-coordinator.ts'
import {
  BATCH_CONTEXT_SCHEMA_VERSION,
  COMMAND_PLAN_SCHEMA_VERSION,
  createPlannerReadSnapshot
} from '../../src/main/domain/event-batch/command-plan.ts'
import { createEventBatchFaultInjectorForTests } from '../../src/main/domain/event-batch/fault-injection.ts'
import { loadVerifiedProjectionSources } from '../../src/main/domain/event-batch/projection-source.ts'
import { PreparedFactRegistry } from '../../src/main/domain/event-batch/result-registry.ts'
import { RuntimeCorruptionState } from '../../src/main/domain/event-batch/runtime-corruption.ts'
import { StartupRecovery } from '../../src/main/domain/event-batch/startup-recovery.ts'
import { FairWriterMutex } from '../../src/main/domain/event-batch/writer-mutex.ts'
import {
  loadSafetyPlannerSnapshot,
  SafetyPlanner
} from '../../src/main/application/planners/safety-planner.ts'
import { registerSafetyPreparedFacts } from '../../src/main/domain/projectors/safety-projector.ts'
import {
  createM5bTempPaths,
  validateThenOpenM5bPaths
} from './m5b-isolated-paths.mjs'

export class M5bIsolatedDatabaseError extends Error {
  constructor(message, { paths = null, cause } = {}) {
    super(message, { cause })
    this.name = 'M5bIsolatedDatabaseError'
    this.paths = paths
  }
}

class SqlJsAdapter {
  constructor(database) {
    this.database = database
    this.transactionActive = false
  }

  prepare(sql) {
    return {
      run: (...params) => {
        this.database.run(sql, params)
      },
      get: (...params) => {
        const statement = this.database.prepare(sql)
        try {
          statement.bind(params)
          return statement.step() ? statement.getAsObject() : undefined
        } finally {
          statement.free()
        }
      },
      all: (...params) => {
        const statement = this.database.prepare(sql)
        const rows = []
        try {
          statement.bind(params)
          while (statement.step()) rows.push(statement.getAsObject())
          return rows
        } finally {
          statement.free()
        }
      }
    }
  }

  transaction(fn) {
    return this.#transaction('BEGIN', fn)
  }

  immediateTransaction(fn) {
    return this.#transaction('BEGIN IMMEDIATE', fn)
  }

  #transaction(beginSql, fn) {
    return () => {
      if (this.transactionActive) throw new Error(`[m5b-isolated-db] nested ${beginSql} is forbidden`)
      this.transactionActive = true
      this.database.exec(beginSql)
      try {
        const result = fn()
        this.database.exec('COMMIT')
        return result
      } catch (error) {
        try {
          this.database.exec('ROLLBACK')
        } catch {
          // Preserve the original transaction error.
        }
        throw error
      } finally {
        this.transactionActive = false
      }
    }
  }

  exec(sql) {
    this.database.exec(sql)
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function writeDurably(path, bytes, flag = 'w') {
  writeFileSync(path, bytes, { flag })
  const descriptor = openSync(path, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function runSqlite(dbPath, sql) {
  const result = spawnSync('sqlite3', ['-batch', dbPath, sql], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(`sqlite3 verification failed: ${result.stderr.trim() || `exit ${result.status}`}`)
  }
  return result.stdout.trim()
}

function assertSqliteFile(dbPath, { target }) {
  if (runSqlite(dbPath, 'PRAGMA integrity_check;') !== 'ok') {
    throw new Error(`integrity_check failed for ${dbPath}`)
  }
  if (runSqlite(dbPath, 'PRAGMA foreign_key_check;') !== '') {
    throw new Error(`foreign_key_check failed for ${dbPath}`)
  }
  const targetCount = Number(runSqlite(
    dbPath,
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('command_log','applied_event_batch','processed_event','projector_cursor');"
  ))
  if (targetCount !== (target ? 4 : 0)) {
    throw new Error(`unexpected T11-T14 table count ${targetCount} for ${dbPath}`)
  }
}

/** The authoritative schema is now v2.2; cutover evidence must begin from exact M4. */
function prepareExactM4Source(adapter) {
  adapter.exec(`
    DROP INDEX IF EXISTS ux_command_idempotency;
    DROP INDEX IF EXISTS idx_applied_event_batch_segment;
    DROP INDEX IF EXISTS idx_processed_event_batch;
    DROP TABLE IF EXISTS processed_event;
    DROP TABLE IF EXISTS applied_event_batch;
    DROP TABLE IF EXISTS projector_cursor;
    DROP TABLE IF EXISTS command_log;
  `)
  adapter.prepare('DELETE FROM schema_migration WHERE migration_id = ?').run(EVENT_BATCH_MIGRATION_ID)
}

function createPairedBackup(paths, database, legacyBytes) {
  const backupDir = join(paths.dataRoot, 'backups', 'pre-migration.m5b.schema')
  const backupDbPath = join(backupDir, 'xc-career-guide.db')
  const backupLogPath = join(backupDir, 'action_log.jsonl')
  const manifestPath = join(backupDir, 'manifest.json')
  mkdirSync(backupDir, { recursive: true })

  writeDurably(paths.dbPath, Buffer.from(database.export()))
  copyFileSync(paths.dbPath, backupDbPath)
  copyFileSync(paths.legacyLogPath, backupLogPath)
  const databaseHash = sha256(readFileSync(backupDbPath))
  const actionLogHash = sha256(readFileSync(backupLogPath))
  writeDurably(manifestPath, `${JSON.stringify({
    stage: 'M5B_SCHEMA',
    migration_id: EVENT_BATCH_MIGRATION_ID,
    database: { file: 'xc-career-guide.db', sha256: databaseHash, integrity_check: 'ok' },
    action_log: { status: 'PRESENT', file: 'action_log.jsonl', sha256: actionLogHash }
  }, null, 2)}\n`, 'wx')

  if (actionLogHash !== sha256(legacyBytes)) throw new Error('paired backup changed legacy action-log bytes')
  assertSqliteFile(backupDbPath, { target: false })
  return { backupDir, backupDbPath, backupLogPath, manifestPath, databaseHash, actionLogHash }
}

function assertQueryPlans(database) {
  const statements = [
    "EXPLAIN QUERY PLAN SELECT * FROM command_log WHERE client_instance_id = 'client' AND idempotency_key = 'key'",
    "EXPLAIN QUERY PLAN SELECT * FROM applied_event_batch WHERE segment_id = 'segment' ORDER BY batch_sequence",
    "EXPLAIN QUERY PLAN SELECT * FROM processed_event WHERE batch_id = 'batch'"
  ]
  const details = statements.flatMap((sql) => database.prepare(sql).all())
    .map((row) => String(row.detail ?? ''))
    .join('\n')
  for (const index of ['ux_command_idempotency', 'idx_applied_event_batch_segment', 'idx_processed_event_batch']) {
    if (!details.includes(index)) throw new Error(`query planner did not select ${index}`)
  }
  return details
}

function restoreAndVerifyBackup(paths, backup, legacyBytes) {
  const restoredDbPath = join(paths.evidenceRoot, 'restored-xc-career-guide.db')
  const restoredLogPath = join(paths.evidenceRoot, 'restored-action_log.jsonl')
  copyFileSync(backup.backupDbPath, restoredDbPath)
  copyFileSync(backup.backupLogPath, restoredLogPath)
  if (sha256(readFileSync(restoredDbPath)) !== backup.databaseHash) throw new Error('restored database hash mismatch')
  if (sha256(readFileSync(restoredLogPath)) !== sha256(legacyBytes)) throw new Error('restored action-log hash mismatch')
  assertSqliteFile(restoredDbPath, { target: false })
  const version = runSqlite(
    restoredDbPath,
    "SELECT schema_version FROM schema_migration WHERE migration_id='2026-07-27_mvp_schema_v0_1_17_multi_device_m4_safety_rekey';"
  )
  if (version !== '0.1.17-multi-device-m4-safety-rekey') {
    throw new Error(`restored database is not exact M4: ${version || 'missing version'}`)
  }
  return { restoredDbPath, restoredLogPath }
}

function verifyStoragePrimitives(paths, golden) {
  const capabilityProbe = probeRequiredFileCapabilities(paths.dataRoot, 'isolated-storage')
  const capability = new DurableFileCapability(paths.dataRoot)
  const legalLegacyBefore = readFileSync(paths.legacyLogPath)
  const legacyInspection = inspectLegacyLogBytes(legalLegacyBefore)
  const legacyAnchor = createLegacyAnchor({
    inspection: legacyInspection,
    sealedAt: '2026-07-29T08:00:00.000Z'
  })
  if (legacyAnchor.sha256 !== golden.legacy.sha256 || legacyAnchor.byte_length !== golden.legacy.byte_length) {
    throw new Error('legacy anchor does not match the frozen byte vector')
  }

  const tailPrefix = Buffer.from(golden.legacy.line, 'utf8')
  const tailBytes = Buffer.from('{"event_id":"isolated-incomplete","payload":{"note":"cut', 'utf8')
  const tailProbePath = join(paths.dataRoot, 'legacy-tail-probe.jsonl')
  writeDurably(tailProbePath, Buffer.concat([tailPrefix, tailBytes]), 'wx')
  const tailInspection = inspectLegacyLogBytes(readFileSync(tailProbePath))
  const repair = archiveAndTruncateLegacyTail({
    dataRoot: paths.dataRoot,
    logRelativePath: 'legacy-tail-probe.jsonl',
    archiveRelativeDirectory: 'legacy-tail-archive',
    repairId: 'isolated-storage',
    inspection: tailInspection
  })
  if (!readFileSync(tailProbePath).equals(tailPrefix)) {
    throw new Error('isolated tail repair changed the verified legacy prefix')
  }
  if (!readFileSync(join(paths.dataRoot, repair.archiveRelativePath)).equals(tailBytes)) {
    throw new Error('isolated tail archive does not contain the exact removed bytes')
  }

  const firstStore = SegmentStore.create(capability, {
    segmentOrdinal: 1,
    nextBatchSequence: 1,
    previousBatchHash: 'GENESIS'
  })
  const prepared = firstStore.appendPrepared(golden.batch.prepared, golden.batch.events)
  const committed = firstStore.appendCommitted(golden.batch.committed)
  const sealed = firstStore.seal('2026-07-29T08:02:00.000Z')
  if (
    prepared.batchHash !== golden.batch.batch_hash
    || committed.finalByteSize !== golden.segment.byte_size
    || sealed.segmentFileHash !== golden.segment.complete_bytes_sha256
  ) throw new Error('isolated segment bytes differ from the frozen vector')

  const nextStore = SegmentStore.create(capability, {
    segmentOrdinal: 2,
    nextBatchSequence: 2,
    previousBatchHash: golden.batch.batch_hash
  })
  nextStore.close()

  const index = rebuildSegmentIndexFromDisk(capability, legacyAnchor)
  if (
    index.segments.length !== 2
    || index.segments[0].state !== 'SEALED'
    || index.segments[1].state !== 'ACTIVE'
    || index.segments[1].byte_size !== 0
    || index.last_batch_hash !== golden.batch.batch_hash
  ) throw new Error('isolated segment index boundaries are inconsistent')
  const published = writeSegmentIndexAtomic({
    capability,
    index,
    expectedSha256: null,
    operationId: 'isolated-storage'
  })
  const readBack = readSegmentIndexFile(capability)
  if (!readBack || readBack.snapshot.sha256 !== published.sha256 || segmentIndexSha256(readBack.index) !== published.sha256) {
    throw new Error('isolated segment index publication is not byte exact')
  }
  const sources = loadSegmentSources(capability)
  const reconcile = reconcileSegmentIndex({ existing: readBack.index, sources, legacyAnchor })
  if (reconcile.status !== 'CURRENT') throw new Error('freshly published segment index is not current')

  const legalLegacyAfter = readFileSync(paths.legacyLogPath)
  if (!legalLegacyAfter.equals(legalLegacyBefore)) {
    throw new Error('storage verification changed legal legacy bytes')
  }
  return {
    capability: capabilityProbe,
    legacy: {
      state: legacyInspection.state,
      byteSize: legalLegacyAfter.length,
      sha256: sha256(legalLegacyAfter),
      preserved: true,
      tailArchivePath: repair.archiveRelativePath
    },
    segment: {
      sealedSegmentId: sealed.segmentId,
      activeSegmentId: index.active_segment_id,
      confirmedBatchCount: sealed.confirmedBatchCount,
      byteSize: sealed.byteSize,
      fileSha256: sealed.segmentFileHash
    },
    index: {
      status: reconcile.status,
      segmentCount: index.segments.length,
      lastGlobalBatchSequence: index.last_global_batch_sequence,
      sha256: published.sha256
    }
  }
}

function verifyCommandPrimitives(adapter) {
  const store = new DurableCommandStore(adapter)
  const password = 'isolated command password'
  const lowCostPasswordHash = sha256(Buffer.from(password, 'utf8'))
  const requestHash = createCommandRequestHash({
    commandType: 'auth:login',
    normalizedBusinessInput: { username: 'isolated-admin', password },
    contract: {
      schemaVersion: 'command-request-hash-v1',
      secretFields: ['password'],
      secretIdentityFields: ['username']
    }
  })
  const registered = store.registerOrLoad({
    commandId: '10000000-0000-4000-8000-000000000001',
    idempotencyKey: '40000000-0000-4000-8000-000000000001',
    clientInstanceId: '30000000-0000-4000-8000-000000000001',
    commandType: 'auth:login',
    actorId: 'UNAUTHENTICATED',
    deviceId: 'isolated-device',
    authSessionId: null,
    requestHash,
    eventBatchId: '20000000-0000-4000-8000-000000000001',
    createdAt: '2026-07-29T09:00:00.000Z',
    maxAttempts: 3
  })
  if (!registered.inserted) throw new Error('isolated command identity was not inserted')
  const firstLease = store.acquireLease({
    commandId: registered.row.commandId,
    seenGeneration: 0,
    workerId: 'isolated-worker-1',
    now: '2026-07-29T09:00:00.000Z',
    allowFailed: true
  })
  if (!firstLease || firstLease.currentLeaseGeneration !== 1 || firstLease.attemptCount !== 1) {
    throw new Error('isolated first command lease is inconsistent')
  }
  store.renewLease({
    commandId: firstLease.commandId,
    leaseOwner: 'isolated-worker-1',
    generation: 1,
    now: '2026-07-29T09:00:10.000Z'
  })
  store.markRetryablePrePonrFailure({
    commandId: firstLease.commandId,
    leaseOwner: 'isolated-worker-1',
    generation: 1,
    errorCode: 'TRANSIENT_IO',
    now: '2026-07-29T09:00:11.000Z',
    stage: 'PRE_PONR_NO_PREPARE'
  })
  const secondLease = store.acquireLease({
    commandId: firstLease.commandId,
    seenGeneration: 1,
    workerId: 'isolated-worker-2',
    now: '2026-07-29T09:00:12.000Z',
    allowFailed: true
  })
  if (!secondLease || secondLease.currentLeaseGeneration !== 2 || secondLease.attemptCount !== 2) {
    throw new Error('isolated command retry lease is inconsistent')
  }
  const resultJson = createCommandResultJson({ success: false, errorCode: 'INVALID_CREDENTIALS' })
  const completed = store.completeSucceeded({
    commandId: secondLease.commandId,
    leaseOwner: 'isolated-worker-2',
    generation: 2,
    resultJson,
    now: '2026-07-29T09:00:13.000Z'
  })
  const persistedRows = adapter.prepare('SELECT * FROM command_log').all()
  const persistedText = JSON.stringify(persistedRows)
  if (persistedText.includes(password) || persistedText.includes(lowCostPasswordHash)) {
    throw new Error('isolated command row contains raw or low-cost password material')
  }
  if (parseCommandResultJson(completed.resultJson).public_result.success !== false) {
    throw new Error('isolated deterministic rejection was not stored as a completed result')
  }
  return {
    commandId: completed.commandId,
    eventBatchId: completed.eventBatchId,
    status: completed.status,
    leaseGeneration: completed.currentLeaseGeneration,
    attemptCount: completed.attemptCount,
    resultSchemaVersion: parseCommandResultJson(completed.resultJson).schema_version,
    rawSecretAbsent: true,
    lowCostSecretHashAbsent: true,
    persisted: false
  }
}

async function verifyGateOnlyPrimitives(database) {
  database.exec('CREATE TABLE isolated_gate_only_probe (probe_id TEXT PRIMARY KEY, value TEXT NOT NULL);')
  const registry = new CommandRegistry()
  registry.registerMutation({
    commandType: 'auth:logout',
    metadata: {
      mode: 'MUTATION',
      executionMode: 'SYNC',
      allowedSources: ['IPC'],
      actorPolicy: { kind: 'ACTIVE_USER', roles: ['TEACHER'] },
      targetResolver: {
        owner: 'isolated-gate-only',
        kind: 'ACTOR_SCOPED',
        locatorFields: [],
        authoritativeFields: ['auth_session.auth_session_id'],
        canonicalTargetFields: ['aggregate_type', 'auth_session_id'],
        clientHintFields: [],
        notFoundMapping: 'SYSTEM_ERROR',
        mismatchMapping: 'SYSTEM_ERROR',
        testReferences: ['m5b-isolated-db.test.mjs']
      },
      payloadContract: 'isolated.gate-only.v1',
      sideEffects: ['ISOLATED_GATE_ONLY_DML'],
      phase: 'M5B_TEST_ONLY',
      transactionOwner: 'gate-only-executor',
      retryPolicy: 'NO_AUTO_RETRY',
      durableCommand: {
        requestHash: {
          schemaVersion: 'command-request-hash-v1',
          secretFields: [],
          secretIdentityFields: []
        },
        resultSchemaVersion: 'command-result-v1',
        resultRecipeVersion: 'isolated.gate-only.result.v1',
        prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
        maxAttempts: 3
      },
      concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: 'isolated-gate-only' },
      publicErrorCodes: ['SYSTEM_ERROR'],
      preflightErrorMap: createPreflightErrorMap('SYSTEM_ERROR'),
      testReferences: ['m5b-isolated-db.test.mjs']
    },
    validateStructure(rawInput) {
      if (rawInput === null || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new Error('invalid isolated gate input')
      return rawInput
    },
    resolveActor() {
      return { kind: 'USER', userId: 'isolated-teacher', role: 'TEACHER', authSessionId: 'isolated-auth-session' }
    },
    normalizeBusinessInput() {
      return {}
    },
    resolveTarget() {
      return { aggregate_type: 'AUTH_SESSION', auth_session_id: 'isolated-auth-session' }
    },
    canonicalPayload() {
      return {}
    },
    concurrencyKey() {
      return 'AUTH_SESSION:isolated-auth-session'
    },
    execute() {
      throw new Error('gate-only executor must not call legacy execute')
    },
    mapUnexpectedExecutionError() {
      return { success: false, errorCode: 'SYSTEM_ERROR' }
    }
  }).seal()
  const ids = [
    '71000000-0000-4000-8000-000000000071',
    '72000000-0000-4000-8000-000000000072'
  ]
  const store = new DurableCommandStore(database)
  const coordinator = new DurableCommandCoordinator({
    registry,
    store,
    workerId: 'isolated-gate-worker',
    uuid: () => ids.shift(),
    now: () => new Date('2026-07-29T12:00:00.000Z')
  })
  const transportMetadata = {
    schemaVersion: 1,
    clientInstanceId: '73000000-0000-4000-8000-000000000073',
    idempotencyKey: '74000000-0000-4000-8000-000000000074',
    deviceId: 'isolated-gate-device'
  }
  const accepted = await coordinator.accept({
    commandType: 'auth:logout',
    rawInput: {},
    transport: { source: 'IPC', transportId: 'isolated-gate-transport' },
    transportMetadata
  })
  if (accepted.status !== 'ACCEPTED') throw new Error('isolated gate command was not accepted')
  const executor = new GateOnlyExecutor({ database, coordinator })
  const completed = executor.execute(accepted, () => {
    database.prepare("INSERT INTO isolated_gate_only_probe (probe_id, value) VALUES ('gate-1', 'committed')").run()
    return { success: true }
  })
  const replayed = await coordinator.accept({
    commandType: 'auth:logout',
    rawInput: {},
    transport: { source: 'IPC', transportId: 'isolated-gate-replay' },
    transportMetadata
  })
  if (replayed.status !== 'REPLAYED') throw new Error('isolated gate command did not replay')
  const probe = database.prepare('SELECT value FROM isolated_gate_only_probe WHERE probe_id = ?').get('gate-1')
  const batchCount = database.prepare('SELECT COUNT(*) AS count FROM applied_event_batch').get()
  if (probe?.value !== 'committed' || batchCount?.count !== 0 || completed.row.status !== 'SUCCEEDED') {
    throw new Error('isolated gate-only atomicity or zero-batch assertion failed')
  }
  return {
    commandId: completed.row.commandId,
    status: completed.row.status,
    replayed: true,
    probeCommitted: true,
    batchCount: batchCount.count,
    persisted: false
  }
}

function isolatedPreparedRegistry() {
  return new PreparedFactRegistry()
    .registerEvent({
      eventType: 'ISOLATED_CHANGED',
      eventPayloadVersion: 1,
      projectorName: 'isolated-projector-v1',
      validatePayload: (payload) => {
        if (payload.event_payload_version !== 1 || typeof payload.value !== 'string') {
          throw new Error('isolated payload is invalid')
        }
      },
      project: ({ database, event }) => {
        database.prepare(
          'INSERT INTO isolated_projection (event_id, value) VALUES (?, ?)'
        ).run(event.record.event_id, event.record.payload.value)
      },
      assertProjected: ({ database, event }) => {
        const row = database.prepare(
          'SELECT value FROM isolated_projection WHERE event_id = ?'
        ).get(event.record.event_id)
        if (!row || row.value !== event.record.payload.value) throw new Error('isolated projection conflicts')
      },
      operationalEffects: [{
        effectType: 'ISOLATED_EFFECT',
        effectVersion: 1,
        apply: ({ database, event }) => {
          database.prepare(
            'INSERT INTO isolated_effect (event_id, value) VALUES (?, ?)'
          ).run(event.record.event_id, `effect:${event.record.payload.value}`)
        },
        assertApplied: ({ database, event }) => {
          const row = database.prepare(
            'SELECT value FROM isolated_effect WHERE event_id = ?'
          ).get(event.record.event_id)
          if (!row || row.value !== `effect:${event.record.payload.value}`) throw new Error('isolated effect conflicts')
        }
      }]
    })
    .registerResult({
      commandType: 'isolated:mutate',
      resultRecipeVersion: 'isolated-result-v1',
      fromPrepared: ({ batch }) => ({
        success: true,
        values: batch.events.map((event) => event.record.payload.value)
      })
    })
    .seal()
}

function isolatedCommand(store, clock, slot, workerId) {
  const tail = String(slot).padStart(12, '0')
  const registered = store.registerOrLoad({
    commandId: `60000000-0000-4000-8000-${tail}`,
    idempotencyKey: `61000000-0000-4000-8000-${tail}`,
    clientInstanceId: `62000000-0000-4000-8000-${tail}`,
    commandType: 'isolated:mutate',
    actorId: 'isolated-admin',
    deviceId: 'isolated-device',
    authSessionId: 'isolated-auth-session',
    requestHash: String(slot).repeat(64),
    eventBatchId: `63000000-0000-4000-8000-${tail}`,
    createdAt: clock().toISOString(),
    maxAttempts: 3
  }).row
  const row = store.acquireLease({
    commandId: registered.commandId,
    seenGeneration: registered.currentLeaseGeneration,
    workerId,
    now: clock().toISOString(),
    allowFailed: true
  })
  if (!row) throw new Error('isolated coordinator command lease was not acquired')
  return {
    row,
    envelope: buildCommandEnvelopeV2({
      commandId: row.commandId,
      commandType: row.commandType,
      source: 'INTERNAL',
      actor: {
        kind: 'USER',
        userId: row.actorId,
        role: 'ADMIN',
        authSessionId: row.authSessionId
      },
      target: { aggregate_id: `isolated-aggregate-${slot}` },
      payload: { requested_values: [] },
      requestHash: row.requestHash,
      createdAt: row.createdAt,
      clientInstanceId: row.clientInstanceId,
      idempotencyKey: row.idempotencyKey,
      eventBatchId: row.eventBatchId,
      actorId: row.actorId,
      deviceId: row.deviceId,
      authSessionId: row.authSessionId,
      leaseOwner: workerId,
      leaseGeneration: row.currentLeaseGeneration
    })
  }
}

function isolatedSafetyCommand(store, clock, workerId) {
  const commandId = '65000000-0000-4000-8000-000000000065'
  const registered = store.registerOrLoad({
    commandId,
    idempotencyKey: '66000000-0000-4000-8000-000000000066',
    clientInstanceId: '67000000-0000-4000-8000-000000000067',
    commandType: 'assessment:triggerRedline',
    actorId: 'isolated-safety-teacher',
    deviceId: 'isolated-safety-device',
    authSessionId: 'isolated-safety-auth-session',
    requestHash: 'a'.repeat(64),
    eventBatchId: '68000000-0000-4000-8000-000000000068',
    createdAt: clock().toISOString(),
    maxAttempts: 3
  }).row
  const row = store.acquireLease({
    commandId: registered.commandId,
    seenGeneration: registered.currentLeaseGeneration,
    workerId,
    now: clock().toISOString(),
    allowFailed: true
  })
  if (!row) throw new Error('isolated safety command lease was not acquired')
  return {
    row,
    envelope: buildCommandEnvelopeV2({
      commandId: row.commandId,
      commandType: row.commandType,
      source: 'INTERNAL',
      actor: {
        kind: 'USER',
        userId: row.actorId,
        role: 'TEACHER',
        authSessionId: row.authSessionId
      },
      target: {
        session_id: 'isolated-safety-assessment',
        student_id: 'isolated-safety-student',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'SHELVE_TASK'
      },
      payload: {
        reasonCode: 'BLADE_TOWARD_SELF',
        contextPhase: 'ONLINE_ASSESSMENT'
      },
      requestHash: row.requestHash,
      createdAt: row.createdAt,
      clientInstanceId: row.clientInstanceId,
      idempotencyKey: row.idempotencyKey,
      eventBatchId: row.eventBatchId,
      actorId: row.actorId,
      deviceId: row.deviceId,
      authSessionId: row.authSessionId,
      leaseOwner: workerId,
      leaseGeneration: row.currentLeaseGeneration
    })
  }
}

function seedSafetyPrimitives(database) {
  const teacherId = 'isolated-safety-teacher'
  const studentId = 'isolated-safety-student'
  const assessmentId = 'isolated-safety-assessment'
  const trainingId = 'isolated-safety-training'
  const stepId = 'isolated-safety-step'
  const jobCode = 'SUPERMARKET_SHELVER'
  const taskCode = 'SHELVE_TASK'

  database.prepare(
    "INSERT INTO user_account (user_id, username, password_hash, role, display_name, status) VALUES (?, 'isolated_safety_teacher', 'isolated', 'TEACHER', 'Isolated Safety Teacher', 'ACTIVE')"
  ).run(teacherId)
  database.prepare(
    "INSERT INTO student_profile (student_id, student_name, status) VALUES (?, 'Isolated Safety Student', 'ACTIVE')"
  ).run(studentId)
  database.prepare(
    "INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by) VALUES (?, 'ASSESSMENT', ?, ?, ?, ?)"
  ).run(assessmentId, studentId, jobCode, taskCode, teacherId)
  database.prepare(
    `INSERT INTO assessment_session (
       session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code,
       strategy_version, status, delivery_phase, online_question_count, offline_question_count, created_by
     ) VALUES (?, ?, ?, 'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', ?, ?, 1, 'INIT', 'PREPARED', 42, 8, ?)`
  ).run(assessmentId, assessmentId, studentId, jobCode, taskCode, teacherId)
  for (const phase of ['ASSIGNED', 'STUDENT_CONFIRMED']) {
    database.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(phase, assessmentId)
  }
  database.prepare(
    "UPDATE assessment_session SET status = 'ACTIVE', delivery_phase = 'ONLINE_IN_PROGRESS' WHERE session_id = ?"
  ).run(assessmentId)

  database.prepare(
    "INSERT INTO business_session (business_session_id, session_type, student_id, job_code, task_code, created_by) VALUES (?, 'TRAINING', ?, ?, ?, ?)"
  ).run(trainingId, studentId, jobCode, taskCode, teacherId)
  database.prepare(
    `INSERT INTO training_session (
       training_session_id, business_session_id, student_id, job_code, task_code, strategy_id,
       strategy_type, strategy_version, status, total_step_count, completed_step_count, created_by
     ) VALUES (?, ?, ?, ?, ?, 'strategy_training_shelver_v1', 'TRAINING_PRACTICE', 1, 'ACTIVE', 1, 0, ?)`
  ).run(trainingId, trainingId, studentId, jobCode, taskCode, teacherId)
  database.prepare(
    "INSERT INTO training_step_record (training_step_record_id, training_session_id, step_code, step_name, step_order, step_type, status, attempt_count) VALUES (?, ?, 'DO', 'Isolated safety step', 1, 'DO', 'IN_PROGRESS', 1)"
  ).run(stepId, trainingId)
  return { assessmentId, trainingId, stepId }
}

async function verifySafetyPrimitives(adapter, paths) {
  const runtimeRoot = join(paths.dataRoot, 'safety-runtime')
  mkdirSync(runtimeRoot, { recursive: false })
  const targets = seedSafetyPrimitives(adapter)
  const store = new DurableCommandStore(adapter)
  const capability = new DurableFileCapability(runtimeRoot)
  const registry = registerSafetyPreparedFacts().seal()
  const workerId = 'isolated-safety-worker'
  const clock = () => new Date('2026-07-30T12:00:00.000Z')
  const accepted = isolatedSafetyCommand(store, clock, workerId)
  let plannerCalls = 0
  const result = await new EventBatchCoordinator({
    database: adapter,
    commandStore: store,
    registry,
    fileCapability: capability,
    writerMutex: new FairWriterMutex(),
    corruptionState: new RuntimeCorruptionState(),
    workerId,
    legacyAnchor: null,
    now: clock
  }).execute({
    envelope: accepted.envelope,
    readSnapshot: () => {
      plannerCalls += 1
      return loadSafetyPlannerSnapshot(adapter, accepted.envelope, {
        timestamp: clock().toISOString(),
        appVersion: '1.0.0-alpha.1'
      })
    },
    planner: new SafetyPlanner()
  })
  const incidentId = result.publicResult.incidentId
  if (typeof incidentId !== 'string' || result.batch?.events.length !== 1 || result.batch.events[0].record.event_type !== 'SAFETY_INCIDENT_CREATED') {
    throw new Error('isolated safety command did not produce exactly one redline event')
  }
  const assessment = adapter.prepare('SELECT status, redline_incident_id FROM assessment_session WHERE session_id = ?').get(targets.assessmentId)
  const training = adapter.prepare('SELECT status, redline_incident_id FROM training_session WHERE training_session_id = ?').get(targets.trainingId)
  const step = adapter.prepare('SELECT status FROM training_step_record WHERE training_step_record_id = ?').get(targets.stepId)
  const bindings = adapter.prepare('SELECT COUNT(*) AS count FROM safety_incident_binding WHERE incident_id = ?').get(incidentId)
  const safetyResult = adapter.prepare(
    `SELECT safety_overridden, level_result, redline_incident_id, is_current
       FROM result_record WHERE source_aggregate_id = ? AND result_type = 'ABILITY_SCORE'`
  ).get(targets.assessmentId)
  if (
    plannerCalls !== 1
    || assessment?.status !== 'REDLINE_HALTED' || assessment?.redline_incident_id !== incidentId
    || training?.status !== 'REDLINE_HALTED' || training?.redline_incident_id !== incidentId
    || step?.status !== 'FAILED' || bindings?.count !== 2
    || safetyResult?.safety_overridden !== 1 || safetyResult?.level_result !== 'LEVEL_FAIL_BY_SAFETY'
    || safetyResult?.redline_incident_id !== incidentId || safetyResult?.is_current !== 1
    || store.findByCommandId(accepted.row.commandId)?.status !== 'SUCCEEDED'
  ) throw new Error('isolated safety redline projection is inconsistent')
  return {
    commandId: accepted.row.commandId,
    incidentId,
    eventCount: result.batch.events.length,
    bindingCount: bindings.count,
    plannerCalls,
    persisted: false
  }
}

function isolatedPlanner(command, slot, values, calls) {
  return {
    plan: ({ envelope }) => {
      calls.count += 1
      const events = values.map((value, index) => ({
        eventId: `64000000-0000-4000-8000-${String(slot * 1000 + index + 1).padStart(12, '0')}`,
        aggregateType: 'SYSTEM',
        aggregateId: `isolated-aggregate-${slot}`,
        eventType: 'ISOLATED_CHANGED',
        eventSequence: index + 1,
        payload: {
          event_payload_version: 1,
          batch_context: {
            schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
            plan_version: 'isolated-plan-v1',
            result_recipe_version: 'isolated-result-v1',
            root_command_type: envelope.commandType,
            root_command_id: envelope.commandId,
            child_ordinal: index
          },
          value
        },
        actorId: envelope.actorId,
        timestamp: command.row.createdAt
      }))
      return {
        schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
        commandId: envelope.commandId,
        commandType: envelope.commandType,
        planVersion: 'isolated-plan-v1',
        resultRecipeVersion: 'isolated-result-v1',
        events,
        operationalEffects: events.map((event) => ({
          sourceEventId: event.eventId,
          eventType: event.eventType,
          effectType: 'ISOLATED_EFFECT',
          effectVersion: 1
        })),
        noOpResult: null
      }
    }
  }
}

async function verifyCoordinatorPrimitives(adapter, paths) {
  adapter.exec(`
    CREATE TABLE isolated_projection (event_id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE isolated_effect (event_id TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  const runtimeRoot = join(paths.dataRoot, 'coordinator-runtime')
  mkdirSync(runtimeRoot, { recursive: false })
  const capability = new DurableFileCapability(runtimeRoot)
  const store = new DurableCommandStore(adapter)
  const mutex = new FairWriterMutex()
  const corruption = new RuntimeCorruptionState()
  let nowMs = new Date('2026-07-29T10:00:00.000Z').getTime()
  const clock = () => new Date(nowMs)
  const registry = isolatedPreparedRegistry()
  const first = isolatedCommand(store, clock, 1, 'isolated-coordinator')
  const firstCalls = { count: 0 }
  await new EventBatchCoordinator({
    database: adapter,
    commandStore: store,
    registry,
    fileCapability: capability,
    writerMutex: mutex,
    corruptionState: corruption,
    workerId: 'isolated-coordinator',
    legacyAnchor: null,
    now: clock
  }).execute({
    envelope: first.envelope,
    readSnapshot: () => createPlannerReadSnapshot({ seed: 'isolated' }),
    planner: isolatedPlanner(first, 1, ['one', 'two'], firstCalls)
  })

  nowMs += 1_000
  const second = isolatedCommand(store, clock, 2, 'isolated-crash-worker')
  const secondCalls = { count: 0 }
  await new EventBatchCoordinator({
    database: adapter,
    commandStore: store,
    registry,
    fileCapability: capability,
    writerMutex: mutex,
    corruptionState: corruption,
    workerId: 'isolated-crash-worker',
    legacyAnchor: null,
    now: clock,
    faultInjector: createEventBatchFaultInjectorForTests({ failAt: 'AFTER_PREPARE_FSYNC' })
  }).execute({
    envelope: second.envelope,
    readSnapshot: () => createPlannerReadSnapshot({ seed: 'isolated' }),
    planner: isolatedPlanner(second, 2, ['three'], secondCalls)
  }).then(
    () => { throw new Error('isolated coordinator fault did not fire') },
    (error) => {
      if (!String(error).includes('AFTER_PREPARE_FSYNC')) throw error
    }
  )

  nowMs += 31_000
  const recovery = await new StartupRecovery({
    database: adapter,
    commandStore: new DurableCommandStore(adapter),
    registry: isolatedPreparedRegistry(),
    fileCapability: new DurableFileCapability(runtimeRoot),
    corruptionState: new RuntimeCorruptionState(),
    workerId: 'isolated-recovery-worker',
    legacyAnchor: null,
    writerMutex: new FairWriterMutex(),
    now: clock
  }).run()
  const sources = loadVerifiedProjectionSources(capability)
  const batches = adapter.prepare(
    'SELECT batch_id, batch_status FROM applied_event_batch ORDER BY batch_sequence'
  ).all()
  if (
    firstCalls.count !== 1
    || secondCalls.count !== 1
    || recovery.plannerCalls !== 0
    || sources.length !== 2
    || sources.some((source) => !source.committed)
    || batches.length !== 2
    || batches.some((batch) => batch.batch_status !== 'CONFIRMED')
    || adapter.prepare('SELECT COUNT(*) AS count FROM processed_event').get().count !== 3
    || adapter.prepare('SELECT COUNT(*) AS count FROM isolated_projection').get().count !== 3
    || adapter.prepare('SELECT COUNT(*) AS count FROM isolated_effect').get().count !== 3
    || store.findByCommandId(first.row.commandId).status !== 'SUCCEEDED'
    || store.findByCommandId(second.row.commandId).status !== 'SUCCEEDED'
  ) throw new Error('isolated coordinator/recovery convergence is inconsistent')
  return {
    batchCount: sources.length,
    eventCount: sources.reduce((sum, source) => sum + source.events.length, 0),
    confirmedCount: batches.length,
    plannerCallsBeforePonr: firstCalls.count + secondCalls.count,
    recoveryPlannerCalls: recovery.plannerCalls,
    recoveredAttemptCount: store.findByCommandId(second.row.commandId).attemptCount,
    relativeSources: sources.every((source) => source.relativePath.startsWith('event-log/segments/')),
    persisted: false
  }
}

function verifyArtifactPrimitives(paths) {
  const artifactRoot = join(paths.dataRoot, 'artifact-runtime')
  const targetPath = join(artifactRoot, 'isolated-report.html')
  const artifactId = 'a5000000-0000-4000-8000-000000000005'
  const bytes = Buffer.from('<html><body>isolated report artifact</body></html>\n', 'utf8')
  mkdirSync(artifactRoot, { recursive: false })
  const interaction = probeArtifactTarget({ artifactRoot, targetPath, artifactId })
  const plan = Object.freeze({
    schema_version: 'report-export-artifact-v1',
    artifact_id: artifactId,
    target_path: targetPath,
    target_identity: interaction.targetIdentity,
    artifact_bytes_base64: bytes.toString('base64'),
    file_hash: sha256(bytes),
    file_size_bytes: bytes.byteLength,
    mime_type: 'text/html'
  })
  const published = publishPreparedArtifact(plan)
  if (published.status !== 'PUBLISHED' || published.cleanupWarning !== null || !readFileSync(targetPath).equals(bytes)) {
    throw new Error('isolated artifact publish is inconsistent')
  }
  rmSync(targetPath)
  const rebuilt = recoverPreparedArtifact(plan)
  if (rebuilt.status !== 'PUBLISHED' || rebuilt.cleanupWarning !== null || !readFileSync(targetPath).equals(bytes)) {
    throw new Error('isolated artifact recovery did not rebuild frozen bytes')
  }
  rmSync(targetPath)
  writeFileSync(targetPath, 'external artifact', { flag: 'wx' })
  let conflict = false
  try {
    recoverPreparedArtifact(plan)
  } catch {
    conflict = true
  }
  if (!conflict || readFileSync(targetPath, 'utf8') !== 'external artifact') {
    throw new Error('isolated artifact recovery overwrote an external target')
  }
  return Object.freeze({
    probeClean: !existsSync(interaction.stagePath),
    published: true,
    rebuilt: true,
    externalTargetPreserved: true
  })
}

export async function runM5bIsolatedDatabaseVerification({
  projectRoot = process.cwd(),
  stage = 'schema',
  pathsFactory = createM5bTempPaths,
  migrate = applyEventBatchMigration
} = {}) {
  if (stage !== 'schema' && stage !== 'storage' && stage !== 'command' && stage !== 'gate-only' && stage !== 'coordinator' && stage !== 'artifact' && stage !== 'safety' && stage !== 'cutover' && stage !== 'full') {
    throw new M5bIsolatedDatabaseError(`[m5b-isolated-db] unsupported stage ${stage}`)
  }
  if (stage === 'cutover' || stage === 'full') {
    const stages = ['schema', 'storage', 'command', 'gate-only', 'coordinator', 'artifact', 'safety']
    const components = {}
    for (const componentStage of stages) {
      components[componentStage] = await runM5bIsolatedDatabaseVerification({
        projectRoot,
        stage: componentStage,
        pathsFactory,
        migrate
      })
    }
    return Object.freeze({
      ok: true,
      stage,
      schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
      components: Object.freeze(components),
      cleaned: stages.every((componentStage) => components[componentStage].cleaned === true)
    })
  }

  let paths = null
  let database = null
  let reopened = null
  try {
    paths = pathsFactory()
    return await validateThenOpenM5bPaths(paths, async (validatedPaths) => {
      paths = validatedPaths
      const SQL = await initSqlJs({
        locateFile: (file) => resolve(projectRoot, 'node_modules', 'sql.js', 'dist', file)
      })
      database = new SQL.Database()
      const adapter = new SqlJsAdapter(database)
      const schema = readFileSync(resolve(projectRoot, 'src/main/db/schema.sql'), 'utf8')
      const golden = JSON.parse(readFileSync(
        resolve(projectRoot, 'scripts/fixtures/m5b-event-batch-golden-v1.json'),
        'utf8'
      ))
      const legacyBytes = Buffer.from(golden.legacy.line, 'utf8')
      adapter.exec(schema)
      prepareExactM4Source(adapter)
      writeDurably(paths.legacyLogPath, legacyBytes, 'wx')
      writeDurably(paths.dbPath, Buffer.from(database.export()), 'wx')

      let backup = null
      const migration = migrate(adapter, {
        createVerifiedBackupBeforeDdl: () => {
          if (backup) throw new Error('paired backup invoked more than once')
          if (inspectEventBatchStructure(adapter) !== 'ABSENT') {
            throw new Error('paired backup was invoked after M5B DDL')
          }
          backup = createPairedBackup(paths, database, legacyBytes)
        }
      })
      if (migration.source !== 'EXACT_M4' || migration.applied !== true) {
        throw new Error(`unexpected migration result ${JSON.stringify(migration)}`)
      }
      if (!backup) throw new Error('historical migration did not create its paired backup')

      assertExactEventBatchStructure(adapter)
      const planDetails = assertQueryPlans(adapter)
      const command = stage === 'command' ? verifyCommandPrimitives(adapter) : null
      const gate = stage === 'gate-only' ? await verifyGateOnlyPrimitives(adapter) : null
      const coordinator = stage === 'coordinator' ? await verifyCoordinatorPrimitives(adapter, paths) : null
      const artifact = stage === 'artifact' ? verifyArtifactPrimitives(paths) : null
      const safety = stage === 'safety' ? await verifySafetyPrimitives(adapter, paths) : null
      writeDurably(paths.dbPath, Buffer.from(database.export()))
      validateThenOpenM5bPaths(paths, () => undefined)
      assertSqliteFile(paths.dbPath, { target: true })

      reopened = new SQL.Database(readFileSync(paths.dbPath))
      const reopenedAdapter = new SqlJsAdapter(reopened)
      assertExactEventBatchStructure(reopenedAdapter)
      if (command) {
        const durableRow = reopenedAdapter.prepare(
          'SELECT status, result_json FROM command_log WHERE command_id = ?'
        ).get(command.commandId)
        if (!durableRow || durableRow.status !== 'SUCCEEDED' || durableRow.result_json === null) {
          throw new Error('isolated completed command did not survive database reopen')
        }
        command.persisted = true
      }
      if (gate) {
        const durableRow = reopenedAdapter.prepare(
          'SELECT status, result_json FROM command_log WHERE command_id = ?'
        ).get(gate.commandId)
        if (!durableRow || durableRow.status !== 'SUCCEEDED' || durableRow.result_json === null) {
          throw new Error('isolated gate-only result did not survive database reopen')
        }
        gate.persisted = true
      }
      if (coordinator) {
        const persisted = reopenedAdapter.prepare(
          "SELECT COUNT(*) AS count FROM command_log WHERE command_type = 'isolated:mutate' AND status = 'SUCCEEDED'"
        ).get()
        const confirmed = reopenedAdapter.prepare(
          "SELECT COUNT(*) AS count FROM applied_event_batch WHERE batch_status = 'CONFIRMED'"
        ).get()
        if (persisted?.count !== 2 || confirmed?.count !== 2) {
          throw new Error('isolated coordinator facts did not survive database reopen')
        }
        coordinator.persisted = true
      }
      if (safety) {
        const durableCommand = reopenedAdapter.prepare(
          "SELECT status, result_json FROM command_log WHERE command_id = ? AND command_type = 'assessment:triggerRedline'"
        ).get(safety.commandId)
        const incident = reopenedAdapter.prepare(
          'SELECT status FROM safety_incident WHERE incident_id = ?'
        ).get(safety.incidentId)
        const bindings = reopenedAdapter.prepare(
          'SELECT COUNT(*) AS count FROM safety_incident_binding WHERE incident_id = ?'
        ).get(safety.incidentId)
        if (durableCommand?.status !== 'SUCCEEDED' || durableCommand?.result_json === null || incident?.status !== 'PENDING_DETAIL' || bindings?.count !== 2) {
          throw new Error('isolated safety facts did not survive database reopen')
        }
        safety.persisted = true
      }
      const restored = restoreAndVerifyBackup(paths, backup, legacyBytes)
      const manifest = JSON.parse(readFileSync(backup.manifestPath, 'utf8'))
      const storage = stage === 'storage' || stage === 'command' || stage === 'gate-only' || stage === 'coordinator' || stage === 'artifact' || stage === 'safety'
        ? verifyStoragePrimitives(paths, golden)
        : null

      const result = {
        ok: true,
        stage,
        paths,
        migration,
        schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
        targetTableCount: 4,
        namedIndexCount: 3,
        queryPlanIndexes: [
          'ux_command_idempotency',
          'idx_applied_event_batch_segment',
          'idx_processed_event_batch'
        ].filter((index) => planDetails.includes(index)),
        backup: {
          databaseHash: backup.databaseHash,
          actionLogHash: backup.actionLogHash,
          manifestStage: manifest.stage,
          restoredDbPath: restored.restoredDbPath,
          restoredLogPath: restored.restoredLogPath
        },
        storage,
        command,
        gate,
        coordinator,
        artifact,
        safety,
        cleaned: true
      }
      database.close()
      database = null
      reopened.close()
      reopened = null
      rmSync(paths.runRoot, { recursive: true, force: true })
      return result
    })
  } catch (cause) {
    try {
      database?.close()
    } catch {
      // Evidence preservation is more important than close diagnostics here.
    }
    try {
      reopened?.close()
    } catch {
      // Preserve the original failure.
    }
    throw new M5bIsolatedDatabaseError(
      `[m5b-isolated-db] FAIL: ${cause instanceof Error ? cause.message : String(cause)}`,
      { paths, cause }
    )
  }
}

export function isolatedEvidenceExists(error) {
  return Boolean(error?.paths?.runRoot && existsSync(error.paths.runRoot))
}
