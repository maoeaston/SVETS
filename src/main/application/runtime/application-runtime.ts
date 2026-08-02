import { resolve } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { DurableCommandCoordinator } from '../command/durable-command-coordinator'
import { DurableCommandStore } from '../command/durable-command-store'
import { CommandRegistry } from '../command/command-registry'
import { EventBatchCoordinator } from '../../domain/event-batch/batch-coordinator'
import { DurableFileCapability } from '../../domain/event-batch/file-capability'
import { createLegacyAnchor, type LegacyAnchorV1 } from '../../domain/event-batch/legacy-anchor'
import {
  archiveAndTruncateLegacyTail,
  inspectLegacyLogFile
} from '../../domain/event-batch/legacy-reader'
import { PreparedFactRegistry } from '../../domain/event-batch/result-registry'
import { RuntimeCorruptionState } from '../../domain/event-batch/runtime-corruption'
import { readSegmentIndexFile } from '../../domain/event-batch/segment-index'
import { StartupRecovery } from '../../domain/event-batch/startup-recovery'
import { registerAssessmentPreparedFacts } from '../../domain/projectors/assessment-projector'
import { registerAssignmentPreparedFacts } from '../../domain/projectors/assignment-projector'
import { registerReportExportPreparedFacts } from '../../domain/projectors/report-export-projector'
import { registerSafetyPreparedFacts } from '../../domain/projectors/safety-projector'
import { registerScoringPreparedFacts } from '../../domain/projectors/scoring-projector'
import { registerTaskClosurePreparedFacts } from '../../domain/projectors/task-closure-projector'
import { registerTrainingPreparedFacts } from '../../domain/projectors/training-projector'
import { registerPrincipalBindingPreparedFacts } from '../../domain/projectors/principal-binding-projector'
import { registerPreviewReleaseContract, registerPreviewReleasePreparedFacts } from '../../domain/projectors/preview-release-projector'
import { registerPreviewSessionContract, registerPreviewSessionPreparedFacts } from '../../domain/projectors/preview-session-projector'
import { registerPreviewSafetyContract, registerPreviewSafetyPreparedFacts } from '../../domain/projectors/preview-safety-projector'
import {
  createFailClosedPreviewTrustContexts,
  type PreviewRuntimeTrustContexts
} from './preview-trust-context'
import { FeedbackVault } from '../../domain/feedback-vault/feedback-vault'
import { registerPreviewFeedbackContract, registerPreviewFeedbackPreparedFacts } from '../../domain/projectors/preview-feedback-projector'
import { registerPreviewErrorContract } from '../../domain/preview/preview-error-contract'
import { registerPreviewQueryContract } from '../../domain/preview/preview-query-contract'
import {
  clearAuthSessionBindingForOwner,
  clearAuthSessionBindingsByOwner,
  sweepInvalidAuthSessions,
  type AuthSessionSweepResult
} from '../../utils/auth-session'
import { bootstrapErrorCodes } from './error-code-bootstrap'
import {
  createInternalMutationCapability,
  prepareInternalDirectory,
  type InternalMutationCapability
} from './internal-mutation-capability'
import { M5bDomainExecutor, projectM5bAssessmentSessionStarted } from './m5b-domain-executor'

export type ApplicationRuntimeState = 'PRE_BOUNDARY_READY' | 'BOUNDARY_READY' | 'CLOSED'
export type RuntimeHealthState = 'STARTING' | 'OPEN' | 'CORRUPTION_READ_ONLY' | 'CLOSED'

export interface RuntimeHealthSnapshot {
  readonly schemaVersion: 'runtime-health-v1'
  readonly state: RuntimeHealthState
  readonly blockingCode: string | null
  readonly evidenceDigest: string | null
  readonly detectedAt: string | null
  readonly legacyRecordCount: number | null
}

export interface RuntimeScheduler {
  setInterval(task: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface ApplicationRuntimeDependencies {
  bootstrapErrorCodes?: (db: DBAdapter, capability: InternalMutationCapability) => void
  prepareDirectory?: (capability: InternalMutationCapability, directoryPath: string) => void
  sweepAuthSessions?: (
    db: DBAdapter,
    capability: InternalMutationCapability,
    options: { bindingOwnerId?: string }
  ) => AuthSessionSweepResult
  scheduler?: RuntimeScheduler
  logRuntimeError?: (record: Readonly<{ owner: string; errorName: string }>) => void
  now?: () => Date
  previewTrustContexts?: PreviewRuntimeTrustContexts
}

export interface CreateApplicationRuntimeOptions {
  db: DBAdapter
  dataRoot: string
  authSweepIntervalMs?: number
  dependencies?: ApplicationRuntimeDependencies
}

export interface ApplicationRuntime {
  readonly runtimeId: string
  readonly bindingOwnerId: string
  readonly dataRoot: string
  readonly db: DBAdapter
  readonly getDb: () => DBAdapter
  readonly commandStore: DurableCommandStore
  readonly corruptionState: RuntimeCorruptionState
  state(): ApplicationRuntimeState
  health(): RuntimeHealthSnapshot
  isBoundaryReady(): boolean
  isWritable(): boolean
  markBoundaryReady(): void
  recoverStartup(): Promise<void>
  createMutationExecutor(registry: CommandRegistry): M5bDomainExecutor
  runAuthMaintenanceNow(): AuthSessionSweepResult
  trackSender(senderId: number, subscribeDestroyed: (release: () => void) => void): void
  releaseSender(senderId: number): void
  registerBoundaryDisposer(disposer: () => void): void
  dispose(): void
}

const DEFAULT_AUTH_SWEEP_INTERVAL_MS = 60_000
const activeDataRoots = new Map<string, symbol | ApplicationRuntimeImpl>()

const defaultScheduler: RuntimeScheduler = {
  setInterval(task, intervalMs) {
    const handle = globalThis.setInterval(task, intervalMs)
    handle.unref?.()
    return handle
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>)
  }
}

function nowIso(now: () => Date): string {
  const value = now().toISOString()
  if (new Date(value).toISOString() !== value) throw new Error('runtime clock is invalid')
  return value
}

function createPreparedRegistry(feedbackVault?: FeedbackVault): PreparedFactRegistry {
  const registry = new PreparedFactRegistry()
  registerAssessmentPreparedFacts(registry, { projectSessionStarted: projectM5bAssessmentSessionStarted })
  registerTrainingPreparedFacts(registry)
  registerTaskClosurePreparedFacts(registry)
  // The scoring registration owns the TASK_REPORT prepared projector too.
  registerScoringPreparedFacts(registry)
  registerAssignmentPreparedFacts(registry)
  registerSafetyPreparedFacts(registry)
  registerReportExportPreparedFacts(registry)
  registerPrincipalBindingPreparedFacts(registry)
  registerPreviewReleasePreparedFacts(registry)
  registerPreviewReleaseContract()
  registerPreviewSessionPreparedFacts(registry)
  registerPreviewSessionContract()
  registerPreviewSafetyPreparedFacts(registry)
  registerPreviewSafetyContract()
  registerPreviewFeedbackPreparedFacts(registry, feedbackVault)
  registerPreviewFeedbackContract()
  registerPreviewErrorContract()
  registerPreviewQueryContract()
  return registry.seal()
}

function prepareLegacyAnchor(options: {
  dataRoot: string
  capability: DurableFileCapability
  now: () => Date
}): { anchor: LegacyAnchorV1 | null; legacyRecordCount: number } {
  const existing = options.capability.readStable('action_log.jsonl')
  if (!existing) {
    const handle = options.capability.createExclusive('action_log.jsonl')
    options.capability.close(handle)
  }
  let inspection = inspectLegacyLogFile(options.dataRoot)
  if (inspection.state === 'RECOVERABLE_INCOMPLETE_TAIL') {
    archiveAndTruncateLegacyTail({
      dataRoot: options.dataRoot,
      archiveRelativeDirectory: 'recovery-archive',
      repairId: uuidv4(),
      inspection
    })
    inspection = inspectLegacyLogFile(options.dataRoot)
  }
  const existingIndex = readSegmentIndexFile(options.capability)
  if (existingIndex) {
    return {
      anchor: existingIndex.index.legacy_anchor,
      legacyRecordCount: existingIndex.index.legacy_anchor?.record_count ?? 0
    }
  }
  const anchor = createLegacyAnchor({ inspection, sealedAt: nowIso(options.now) })
  return { anchor, legacyRecordCount: anchor.record_count }
}

class ApplicationRuntimeImpl implements ApplicationRuntime {
  readonly runtimeId = uuidv4()
  readonly bindingOwnerId = `application-runtime:${this.runtimeId}`
  readonly getDb = (): DBAdapter => this.db
  readonly corruptionState = new RuntimeCorruptionState()
  readonly commandStore: DurableCommandStore
  private runtimeState: ApplicationRuntimeState = 'PRE_BOUNDARY_READY'
  private maintenanceHandle: unknown = null
  private readonly trackedSenderIds = new Set<number>()
  private readonly boundaryDisposers: Array<() => void> = []
  private readonly maintenanceCapability: InternalMutationCapability
  private readonly preparedRegistry: PreparedFactRegistry
  private readonly capability: DurableFileCapability
  private readonly legacyAnchor: LegacyAnchorV1 | null
  private readonly legacyRecordCount: number
  private readonly startupRecovery: StartupRecovery
  private readonly batchCoordinator: EventBatchCoordinator
  private readonly feedbackVault: FeedbackVault

  constructor(
    readonly db: DBAdapter,
    readonly dataRoot: string,
    private readonly sweepIntervalMs: number,
    private readonly scheduler: RuntimeScheduler,
    private readonly sweepAuthSessions: NonNullable<ApplicationRuntimeDependencies['sweepAuthSessions']>,
    private readonly logRuntimeError: NonNullable<ApplicationRuntimeDependencies['logRuntimeError']>,
    private readonly now: () => Date,
    private readonly previewTrustContexts: PreviewRuntimeTrustContexts
  ) {
    this.maintenanceCapability = createInternalMutationCapability({
      owner: 'application-runtime:auth-session-sweep',
      phase: 'RUNTIME_MAINTENANCE',
      dataRoot
    })
    this.capability = new DurableFileCapability(dataRoot)
    this.feedbackVault = new FeedbackVault(this.capability)
    const legacy = prepareLegacyAnchor({ dataRoot, capability: this.capability, now })
    this.legacyAnchor = legacy.anchor
    this.legacyRecordCount = legacy.legacyRecordCount
    this.preparedRegistry = createPreparedRegistry(this.feedbackVault)
    this.commandStore = new DurableCommandStore(db)
    const workerId = `runtime:${this.runtimeId}`
    this.batchCoordinator = new EventBatchCoordinator({
      database: db,
      commandStore: this.commandStore,
      registry: this.preparedRegistry,
      fileCapability: this.capability,
      corruptionState: this.corruptionState,
      workerId,
      legacyAnchor: this.legacyAnchor,
      now
    })
    this.startupRecovery = new StartupRecovery({
      database: db,
      commandStore: this.commandStore,
      registry: this.preparedRegistry,
      fileCapability: this.capability,
      corruptionState: this.corruptionState,
      workerId,
      legacyAnchor: this.legacyAnchor,
      now
    })
  }

  startMaintenance(): void {
    this.maintenanceHandle = this.scheduler.setInterval(() => {
      if (this.runtimeState === 'CLOSED') return
      try {
        this.runAuthMaintenanceNow()
      } catch (error) {
        this.logRuntimeError({
          owner: 'application-runtime:auth-session-sweep',
          errorName: error instanceof Error ? error.name : 'UnknownError'
        })
      }
    }, this.sweepIntervalMs)
  }

  state(): ApplicationRuntimeState {
    return this.runtimeState
  }

  health(): RuntimeHealthSnapshot {
    const corruption = this.corruptionState.snapshot()
    const state: RuntimeHealthState = this.runtimeState === 'CLOSED'
      ? 'CLOSED'
      : corruption.state === 'CORRUPTION_READ_ONLY'
        ? 'CORRUPTION_READ_ONLY'
        : this.runtimeState === 'BOUNDARY_READY'
          ? 'OPEN'
          : 'STARTING'
    return Object.freeze({
      schemaVersion: 'runtime-health-v1',
      state,
      blockingCode: corruption.code,
      evidenceDigest: corruption.evidenceDigest,
      detectedAt: corruption.detectedAt,
      legacyRecordCount: this.legacyRecordCount
    })
  }

  isBoundaryReady(): boolean {
    return this.runtimeState === 'BOUNDARY_READY'
  }

  isWritable(): boolean {
    return this.isBoundaryReady() && this.corruptionState.snapshot().state === 'OPEN'
  }

  markBoundaryReady(): void {
    if (this.runtimeState !== 'PRE_BOUNDARY_READY') {
      throw new Error(`cannot mark boundary ready from ${this.runtimeState}`)
    }
    this.runtimeState = 'BOUNDARY_READY'
  }

  async recoverStartup(): Promise<void> {
    if (this.runtimeState === 'CLOSED') throw new Error('application runtime is closed')
    try {
      await this.startupRecovery.run()
    } catch (error) {
      this.corruptionState.transition({
        code: 'STARTUP_RECOVERY_FAILED',
        evidence: error instanceof Error ? `${error.name}:${error.message}` : String(error),
        detectedAt: nowIso(this.now)
      })
      this.logRuntimeError({
        owner: 'application-runtime:startup-recovery',
        errorName: error instanceof Error ? error.name : 'UnknownError'
      })
    }
  }

  createMutationExecutor(registry: CommandRegistry): M5bDomainExecutor {
    if (!registry.isSealed()) throw new Error('M5B command registry must be sealed before installation')
    return new M5bDomainExecutor({
      database: this.db,
      durableCoordinator: new DurableCommandCoordinator({
        registry,
        store: this.commandStore,
        workerId: `runtime:${this.runtimeId}`,
        now: this.now
      }),
      batchCoordinator: this.batchCoordinator,
      previewPrincipalTrustContext: this.previewTrustContexts.principal,
      previewReleaseTrustContext: this.previewTrustContexts.release,
      feedbackVault: this.feedbackVault,
      previewFeedbackTrustContext: this.previewTrustContexts.feedback
    })
  }

  runAuthMaintenanceNow(): AuthSessionSweepResult {
    if (this.runtimeState === 'CLOSED') throw new Error('application runtime is closed')
    return this.sweepAuthSessions(this.db, this.maintenanceCapability, {
      bindingOwnerId: this.bindingOwnerId
    })
  }

  trackSender(senderId: number, subscribeDestroyed: (release: () => void) => void): void {
    if (this.runtimeState === 'CLOSED') throw new Error('application runtime is closed')
    if (this.trackedSenderIds.has(senderId)) return
    this.trackedSenderIds.add(senderId)
    subscribeDestroyed(() => this.releaseSender(senderId))
  }

  releaseSender(senderId: number): void {
    clearAuthSessionBindingForOwner(senderId, this.bindingOwnerId)
    this.trackedSenderIds.delete(senderId)
  }

  registerBoundaryDisposer(disposer: () => void): void {
    if (this.runtimeState === 'CLOSED') throw new Error('application runtime is closed')
    this.boundaryDisposers.push(disposer)
  }

  dispose(): void {
    if (this.runtimeState === 'CLOSED') return
    this.runtimeState = 'CLOSED'
    for (const disposer of this.boundaryDisposers.splice(0).reverse()) {
      try {
        disposer()
      } catch (error) {
        this.logRuntimeError({
          owner: 'application-runtime:boundary-dispose',
          errorName: error instanceof Error ? error.name : 'UnknownError'
        })
      }
    }
    if (this.maintenanceHandle !== null) {
      this.scheduler.clearInterval(this.maintenanceHandle)
      this.maintenanceHandle = null
    }
    clearAuthSessionBindingsByOwner(this.bindingOwnerId)
    this.trackedSenderIds.clear()
    if (activeDataRoots.get(this.dataRoot) === this) activeDataRoots.delete(this.dataRoot)
  }
}

export function createApplicationRuntime(options: CreateApplicationRuntimeOptions): ApplicationRuntime {
  const dataRoot = resolve(options.dataRoot)
  if (activeDataRoots.has(dataRoot)) {
    throw new Error(`application runtime already owns data root: ${dataRoot}`)
  }
  const sweepIntervalMs = options.authSweepIntervalMs ?? DEFAULT_AUTH_SWEEP_INTERVAL_MS
  if (!Number.isFinite(sweepIntervalMs) || sweepIntervalMs <= 0) {
    throw new Error('auth sweep interval must be a positive finite number')
  }

  const reservation = Symbol(dataRoot)
  activeDataRoots.set(dataRoot, reservation)
  try {
    const dependencies = options.dependencies ?? {}
    const seed = dependencies.bootstrapErrorCodes ?? bootstrapErrorCodes
    const sweep = dependencies.sweepAuthSessions ?? sweepInvalidAuthSessions
    const scheduler = dependencies.scheduler ?? defaultScheduler
    const now = dependencies.now ?? (() => new Date())
    const previewTrustContexts = dependencies.previewTrustContexts ?? createFailClosedPreviewTrustContexts()
    const logRuntimeError = dependencies.logRuntimeError ?? ((record) => {
      console.error(`[runtime] ${record.owner} failed: ${record.errorName}`)
    })
    prepareInternalDirectory(createInternalMutationCapability({
      owner: 'application-runtime:event-batch-data-root',
      phase: 'POST_DB_INIT_PRE_BOUNDARY_READY',
      dataRoot
    }), dataRoot)
    const seedCapability = createInternalMutationCapability({
      owner: 'application-runtime:error-code-bootstrap',
      phase: 'POST_DB_INIT_PRE_BOUNDARY_READY',
      dataRoot
    })
    seed(options.db, seedCapability)
    const runtime = new ApplicationRuntimeImpl(
      options.db,
      dataRoot,
      sweepIntervalMs,
      scheduler,
      sweep,
      logRuntimeError,
      now,
      previewTrustContexts
    )
    activeDataRoots.set(dataRoot, runtime)
    runtime.startMaintenance()
    return runtime
  } catch (error) {
    if (activeDataRoots.get(dataRoot) === reservation) activeDataRoots.delete(dataRoot)
    throw error
  }
}

export async function startApplicationRuntime(options: {
  runtime: CreateApplicationRuntimeOptions
  registerBoundary(runtime: ApplicationRuntime): void
}): Promise<ApplicationRuntime> {
  const runtime = createApplicationRuntime(options.runtime)
  try {
    await runtime.recoverStartup()
    options.registerBoundary(runtime)
    runtime.markBoundaryReady()
    return runtime
  } catch (error) {
    runtime.dispose()
    throw error
  }
}
